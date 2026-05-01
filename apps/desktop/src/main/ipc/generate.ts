import path_module from 'node:path';
import {
  type AgentEvent,
  buildApplyCommentUserPrompt,
  type CoreLogger,
  composeSystemPrompt,
  type GenerateImageAssetRequest,
  type GenerateImageAssetResult,
  generateTitle,
  generateViaAgent,
  loadDesignSkills,
  loadFrameTemplates,
  type UpdateDesignMemoryInput,
} from '@open-codesign/core';
import { detectProviderFromKey, generateImage } from '@open-codesign/providers';
import {
  ApplyCommentPayload,
  CancelGenerationPayloadV1,
  CodesignError,
  deriveResourceStateFromChatRows,
  GeneratePayloadV1,
  type ResourceStateV1,
} from '@open-codesign/shared';
import { computeFingerprint } from '@open-codesign/shared/fingerprint';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import type { AgentStreamEvent } from '../../preload/index';
import { requestAsk } from '../ask-ipc';
import { CHATGPT_CODEX_PROVIDER_ID, getCodexTokenStore } from '../codex-oauth-ipc';
import { makeRuntimeVerifier } from '../done-verify';
import { app, ipcMain } from '../electron-runtime';
import {
  armGenerationTimeout,
  cancelGenerationRequest,
  extractGenerationTimeoutError,
  withInFlightGeneration,
} from '../generation-ipc';
import { resolveGenerationWorkspaceRoot } from '../generation-workspace';
import { resolveImageGenerationConfig, toGenerateImageOptions } from '../image-generation-settings';
import { getLogger } from '../logger';
import { loadMemoryContext, triggerMemoryUpdate } from '../memory-ipc';
import { getApiKeyForProvider, getCachedConfig, hasApiKeyForProvider } from '../onboarding-ipc';
import { readPersisted as readPreferences } from '../preferences-ipc';
import { runPreview } from '../preview-runtime';
import { preparePromptContext } from '../prompt-context';
import { createProviderContextStore } from '../provider-context';
import { resolveActiveModel } from '../provider-settings';
import { resolveActiveApiKey, resolveCredentialForProvider } from '../resolve-api-key';
import { withRun } from '../runContext';
import { listSessionChatMessages, type SessionChatStoreOptions } from '../session-chat';
import { type Database, getDesign, recordDiagnosticEvent } from '../snapshots-db';
import { readWorkspaceFilesAt } from '../workspace-reader';
import { allocateAssetPath, createRuntimeTextEditorFs, resolveLocalAssetRefs } from './runtime-fs';

/**
 * Pull an HTTP status code out of a caught provider error. Mirrors
 * `packages/providers/src/retry.ts::extractStatus` intentionally — we don't
 * import from retry.ts to avoid coupling main to a retry-internal helper
 * that might get reshaped. Used by the generate catch block to tag the
 * thrown err with `upstream_status` so the renderer's diagnose pipeline
 * can pick up a hypothesis.
 */
function extractUpstreamHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates: unknown[] = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { upstream_status?: unknown }).upstream_status,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 100 && c < 600) return c;
  }
  if (err instanceof Error) {
    const m = /\b(\d{3})\b/.exec(err.message);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 400 && n < 600) return n;
    }
  }
  return undefined;
}

function resolveActiveApiKeyFromState(providerId: string): Promise<string> {
  return resolveActiveApiKey(providerId, {
    getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
    getApiKeyForProvider,
  });
}

function resolveApiKeyForActive(providerId: string, allowKeyless: boolean): Promise<string> {
  return resolveCredentialForProvider(providerId, allowKeyless, {
    getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
    getApiKeyForProvider,
    hasApiKeyForProvider,
  });
}

export interface RegisterGenerateIpcDeps {
  db: Database | null;
  getMainWindow: () => ElectronBrowserWindow | null;
}

/**
 * Registers the agent-loop IPC handlers (generate / apply-comment / title /
 * cancel / detect-provider / done:verify). Returns a teardown closure that
 * aborts every in-flight generation — call from the app `before-quit` hook.
 */
export function registerGenerateIpc({ db, getMainWindow }: RegisterGenerateIpcDeps): () => void {
  const logIpc = getLogger('main:ipc');

  // Cache of the last NormalizedProviderError seen per run, so recordFinalError
  // can attach it to the final (non-transient) row. Without this, the row the
  // user actually reports lacks upstream_request_id / status — those fields
  // lived only on the hidden transient sibling row emitted by retry.ts.
  // Implementation + LRU eviction lives in ../provider-context.ts.
  const providerContext = createProviderContextStore(50);

  const recordFinalError = (scope: string, runId: string, err: unknown): void => {
    if (db === null) return;
    const code = err instanceof CodesignError ? (err.code as string) : 'PROVIDER_UPSTREAM_ERROR';
    const stack = err instanceof Error ? err.stack : undefined;
    const message = err instanceof Error ? err.message : String(err);
    const context = providerContext.consume(runId);
    recordDiagnosticEvent(db, {
      level: 'error',
      code,
      scope,
      runId,
      fingerprint: computeFingerprint({ errorCode: code, stack, message }),
      message,
      stack,
      transient: false,
      ...(context !== undefined ? { context } : {}),
    });
  };

  /** Adapter so `core` can log step events through the same scoped electron-log
   * sink the IPC handler uses. Keeps a single timeline per generation in the
   * log file without forcing `core` to depend on electron-log.
   *
   * Only `provider.error` (retry in flight, transient=true) is persisted from
   * this adapter; the `provider.error.final` event is NOT recorded because the
   * outer handler's catch block calls `recordFinalError` — recording both
   * would double-count the same failure with two distinct fingerprints. */
  const coreLoggerFor = (id: string): CoreLogger => ({
    info: (event, data) => logIpc.info(event, { generationId: id, ...(data ?? {}) }),
    warn: (event, data) => {
      logIpc.warn(event, { generationId: id, ...(data ?? {}) });
      if (event === 'provider.error' && db !== null) {
        const code = 'PROVIDER_UPSTREAM_ERROR';
        const upstream =
          data !== undefined && typeof data['upstream_message'] === 'string'
            ? (data['upstream_message'] as string)
            : event;
        // Fingerprint basis: errorCode + synthetic frame containing the two
        // fields that truly differentiate provider errors — upstream_status
        // and upstream_code. JSON-stringifying `data` and passing it as
        // `stack` would produce an identical 8-hex for every provider error
        // because `extractTopFrames` requires lines starting with "at ".
        const status =
          typeof data?.['upstream_status'] === 'number' ? data['upstream_status'] : '?';
        const upstreamCode =
          typeof data?.['upstream_code'] === 'string' ? data['upstream_code'] : 'unknown';
        const syntheticFrame = `    at provider (${status}:${upstreamCode})`;
        if (data !== undefined) providerContext.remember(id, data);
        recordDiagnosticEvent(db, {
          level: 'warn',
          code,
          scope: 'provider',
          runId: id,
          fingerprint: computeFingerprint({
            errorCode: code,
            stack: syntheticFrame,
            message: upstream,
          }),
          message: upstream,
          stack: undefined,
          transient: true,
          ...(data !== undefined ? { context: data } : {}),
        });
      }
    },
    error: (event, data) => logIpc.error(event, { generationId: id, ...(data ?? {}) }),
  });

  const requireWorkspaceRootForDesign = (
    designId: string | undefined,
  ): { designId: string; workspaceRoot: string } => resolveGenerationWorkspaceRoot(db, designId);

  const chatStoreOptions = (): SessionChatStoreOptions | null => {
    if (db === null) return null;
    return {
      db,
      sessionDir: db.sessionDir,
    };
  };

  const resourceStateForDesign = (designId: string | null): ResourceStateV1 | undefined => {
    if (designId === null) return undefined;
    const opts = chatStoreOptions();
    if (opts === null) return undefined;
    return deriveResourceStateFromChatRows(listSessionChatMessages(opts, designId));
  };

  /**
   * Dispatches a generate request through the agent runtime. Forwards
   * normalized `AgentEvent`s to the renderer via `agent:event:v1` so the
   * sidebar chat can render incremental output.
   */
  const runGenerate = async (
    input: Parameters<typeof generateViaAgent>[0],
    id: string,
    designId: string,
    previousHtml: string | null,
    workspaceRoot: string,
    memoryCallbacks?: {
      onAggressivePrune?: () => void;
      onComplete?: (messages: UpdateDesignMemoryInput['conversationMessages']) => void;
    },
  ): ReturnType<typeof generateViaAgent> => {
    const sendEvent = (event: AgentStreamEvent) => {
      getMainWindow()?.webContents.send('agent:event:v1', event);
    };
    const baseCtx = { designId, generationId: id } as const;
    const toolStartedAt = new Map<string, number>();
    const runtimeVerify = makeRuntimeVerifier();
    const templatesRoot = path_module.join(app.getPath('userData'), 'templates');
    const [frames, designSkills] = await Promise.all([
      loadFrameTemplates(path_module.join(templatesRoot, 'frames')),
      loadDesignSkills(path_module.join(templatesRoot, 'design-skills')),
    ]);
    const { fs, fsMap } = createRuntimeTextEditorFs({
      db,
      designId,
      generationId: id,
      logger: logIpc,
      previousHtml,
      sendEvent,
      frames,
      designSkills,
    });
    const cfg = getCachedConfig();
    const imageConfig = cfg ? resolveImageGenerationConfig(cfg) : null;
    const imageLog = getLogger('image-generation');
    const generateImageAsset = imageConfig
      ? async (
          request: GenerateImageAssetRequest,
          signal?: AbortSignal,
        ): Promise<GenerateImageAssetResult> => {
          const started = Date.now();
          const options = toGenerateImageOptions(
            imageConfig,
            request.prompt,
            signal,
            request.aspectRatio,
          );
          imageLog.info('provider.request', {
            generationId: id,
            provider: options.provider,
            model: options.model,
            size: options.size,
            aspectRatio: request.aspectRatio ?? 'default',
            purpose: request.purpose,
            quality: options.quality,
            outputFormat: options.outputFormat,
            promptChars: options.prompt.length,
          });
          try {
            const image = await generateImage(options);
            const path = allocateAssetPath(fsMap, request, image.mimeType);
            imageLog.info('provider.ok', {
              generationId: id,
              provider: image.provider,
              model: image.model,
              path,
              ms: Date.now() - started,
              revised: image.revisedPrompt !== undefined,
            });
            return {
              path,
              dataUrl: image.dataUrl,
              mimeType: image.mimeType,
              model: image.model,
              provider: image.provider,
              ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}),
            };
          } catch (err) {
            imageLog.warn('provider.fail', {
              generationId: id,
              provider: options.provider,
              model: options.model,
              ms: Date.now() - started,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        }
      : undefined;

    let deltaCount = 0;
    let toolCount = 0;

    return generateViaAgent(
      {
        ...input,
        templatesRoot,
        askBridge: (askInput) => requestAsk(id, askInput, () => getMainWindow()),
        workspaceRoot,
        readWorkspaceFiles: (patterns) => readWorkspaceFilesAt(workspaceRoot, patterns),
        runPreview: ({ path, vision }) => runPreview({ path, vision, workspaceRoot }),
      },
      {
        fs,
        runtimeVerify,
        ...(generateImageAsset !== undefined ? { generateImageAsset } : {}),
        ...(memoryCallbacks?.onAggressivePrune !== undefined
          ? { onAggressivePrune: memoryCallbacks.onAggressivePrune }
          : {}),
        ...(memoryCallbacks?.onComplete !== undefined
          ? { onComplete: memoryCallbacks.onComplete }
          : {}),
        onEvent: (event: AgentEvent) => {
          if (event.type === 'turn_start') {
            deltaCount = 0;
            toolCount = 0;
            logIpc.info('agent.turn_start', { generationId: id });
          } else if (event.type === 'message_update') {
            const ame = event.assistantMessageEvent;
            if (ame.type === 'text_delta') deltaCount += 1;
          } else if (event.type === 'tool_execution_start') {
            toolCount += 1;
            logIpc.info('agent.tool_start', { generationId: id, tool: event.toolName });
          } else if (event.type === 'tool_execution_end') {
            logIpc.info('agent.tool_end', {
              generationId: id,
              tool: event.toolName,
              isError: event.isError,
            });
          } else if (event.type === 'turn_end') {
            logIpc.info('agent.turn_end', {
              generationId: id,
              deltas: deltaCount,
              tools: toolCount,
            });
          } else if (event.type === 'agent_end') {
            logIpc.info('agent.end', { generationId: id });
          }
          if (designId === null) return;
          if (event.type === 'turn_start') {
            sendEvent({ ...baseCtx, type: 'turn_start' });
            return;
          }
          if (event.type === 'message_update') {
            const ame = event.assistantMessageEvent;
            if (ame.type === 'text_delta' && typeof ame.delta === 'string') {
              sendEvent({ ...baseCtx, type: 'text_delta', delta: ame.delta });
            }
            return;
          }
          if (event.type === 'tool_execution_start') {
            toolStartedAt.set(event.toolCallId, Date.now());
            const argsObj =
              typeof event.args === 'object' && event.args !== null
                ? (event.args as Record<string, unknown>)
                : {};
            const command =
              typeof argsObj['command'] === 'string' ? (argsObj['command'] as string) : undefined;
            sendEvent({
              ...baseCtx,
              type: 'tool_call_start',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              args: argsObj,
              ...(command ? { command } : {}),
            });
            return;
          }
          if (event.type === 'tool_execution_end') {
            const startedAt = toolStartedAt.get(event.toolCallId) ?? Date.now();
            toolStartedAt.delete(event.toolCallId);
            sendEvent({
              ...baseCtx,
              type: 'tool_call_result',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              result: event.result,
              durationMs: Date.now() - startedAt,
            });
            return;
          }
          if (event.type === 'turn_end') {
            const msg = event.message as { content?: Array<{ type: string; text?: string }> };
            const rawText = (msg.content ?? [])
              .filter(
                (c): c is { type: 'text'; text: string } =>
                  c.type === 'text' && typeof c.text === 'string',
              )
              .map((c) => c.text)
              .join('');
            // Strip <artifact ...>...</artifact> blocks — artifact content is
            // delivered via fs_updated / artifact_delivered, not the chat text.
            // The second pattern catches the cancel-mid-stream case where only
            // the opening tag has landed.
            const finalText = rawText
              .replace(/<artifact[\s\S]*?<\/artifact>/g, '')
              .replace(/<artifact\b[\s\S]*$/g, '')
              .trim();
            sendEvent({ ...baseCtx, type: 'turn_end', finalText });
            return;
          }
          if (event.type === 'agent_end') {
            sendEvent({ ...baseCtx, type: 'agent_end' });
            return;
          }
        },
      },
    ).then((result) => ({
      ...result,
      artifacts: result.artifacts.map((artifact) => ({
        ...artifact,
        content: resolveLocalAssetRefs(artifact.content, fsMap),
      })),
    }));
  };

  /** In-flight requests: generationId → AbortController */
  const inFlight = new Map<string, AbortController>();

  const armTimeout = (id: string, controller: AbortController) =>
    armGenerationTimeout(
      id,
      controller,
      async () => (await readPreferences()).generationTimeoutSec,
      logIpc,
    );

  ipcMain.handle('codesign:detect-provider', (_e, key: unknown) => {
    if (typeof key !== 'string') {
      throw new CodesignError('detect-provider expects a string key', 'IPC_BAD_INPUT');
    }
    return detectProviderFromKey(key);
  });

  // Standalone runtime-verify IPC. Renderer / debug callers can invoke this
  // directly to dry-run an artifact without going through the agent loop.
  const sharedRuntimeVerifier = makeRuntimeVerifier();
  ipcMain.handle('done:verify:v1', async (_e, raw: unknown) => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as { artifact?: unknown }).artifact !== 'string'
    ) {
      throw new CodesignError('done:verify:v1 expects { artifact: string }', 'IPC_BAD_INPUT');
    }
    const errors = await sharedRuntimeVerifier((raw as { artifact: string }).artifact);
    return { errors };
  });

  ipcMain.handle('codesign:v1:generate', async (_e, raw: unknown) => {
    const payload = GeneratePayloadV1.parse(raw);
    const id = payload.generationId;
    return withRun(id, async () => {
      const controller = new AbortController();
      return withInFlightGeneration(id, inFlight, controller, async () => {
        const coreLogger = coreLoggerFor(id);

        coreLogger.info('[generate] step=load_config');
        const loadStart = Date.now();
        const cfg = getCachedConfig();
        if (cfg === null) {
          throw new CodesignError(
            'No configuration found. Complete onboarding first.',
            'CONFIG_MISSING',
          );
        }
        const active = resolveActiveModel(cfg, payload.model);
        const allowKeyless = active.allowKeyless;
        const apiKey = await resolveApiKeyForActive(active.model.provider, allowKeyless);
        // Once we've snapped to the canonical active provider, the renderer-supplied
        // baseUrl can no longer be trusted — it may belong to a different (stale)
        // provider. Always use the per-provider baseUrl from cached config.
        const baseUrl = active.baseUrl ?? undefined;
        if (active.overridden) {
          payload.baseUrl = baseUrl;
        }
        coreLogger.info('[generate] step=load_config.ok', {
          ms: Date.now() - loadStart,
          hasApiKey: apiKey.length > 0,
          baseUrl: baseUrl ?? '<default>',
        });

        if (active.overridden) {
          coreLogger.info('[generate] step=resolve_active.override', {
            requested: payload.model.provider,
            requestedModelId: payload.model.modelId,
            active: active.model.provider,
            activeModelId: active.model.modelId,
          });
        }

        const stepCtx = {
          generationId: id,
          provider: active.model.provider,
          modelId: active.model.modelId,
        };
        coreLogger.info('[generate] step=validate_provider', stepCtx);
        if (apiKey.length === 0 && !allowKeyless) {
          coreLogger.error('[generate] step=validate_provider.fail', {
            provider: active.model.provider,
            reason: 'missing_api_key',
          });
          throw new CodesignError(
            `No API key configured for provider "${active.model.provider}". Open Settings to add one.`,
            'PROVIDER_AUTH_MISSING',
          );
        }
        coreLogger.info('[generate] step=validate_provider.ok', {
          provider: active.model.provider,
        });

        const { designId, workspaceRoot } = requireWorkspaceRootForDesign(payload.designId);
        const promptContext = await preparePromptContext({
          attachments: payload.attachments,
          referenceUrl: payload.referenceUrl,
          designSystem: cfg.designSystem ?? null,
          workspaceRoot,
        });
        let memoryContext: string[] | undefined;
        let memoryLoadWarning: string | undefined;
        try {
          memoryContext = await loadMemoryContext(workspaceRoot);
        } catch (err) {
          memoryLoadWarning = `Project memory unavailable: ${err instanceof Error ? err.message : String(err)}`;
          logIpc.warn('memory.load.fail', {
            generationId: id,
            message: err instanceof Error ? err.message : String(err),
          });
        }

        logIpc.info('generate', {
          generationId: id,
          provider: active.model.provider,
          modelId: active.model.modelId,
          ...(active.overridden
            ? { requestedProvider: payload.model.provider, requestedModelId: payload.model.modelId }
            : {}),
          promptLen: payload.prompt.length,
          historyLen: payload.history.length,
          attachmentCount: payload.attachments.length,
          hasReferenceUrl: payload.referenceUrl !== undefined,
          hasDesignSystem: promptContext.designSystem !== null,
          baseUrl: baseUrl ?? '<default>',
        });

        const t0 = Date.now();
        let clearTimeoutGuard: () => void = () => {};
        try {
          clearTimeoutGuard = await armTimeout(id, controller);
          const isCodex = active.model.provider === CHATGPT_CODEX_PROVIDER_ID;
          let capturedMessages: UpdateDesignMemoryInput['conversationMessages'] | null = null;
          let aggressivePruneDetected = false;
          const result = await runGenerate(
            {
              prompt: payload.prompt,
              history: payload.history,
              model: active.model,
              apiKey,
              ...(isCodex
                ? { getApiKey: () => resolveActiveApiKeyFromState(active.model.provider) }
                : {}),
              attachments: promptContext.attachments,
              referenceUrl: promptContext.referenceUrl,
              designSystem: promptContext.designSystem ?? null,
              ...(memoryContext !== undefined ? { memoryContext } : {}),
              projectContext: promptContext.projectContext,
              initialResourceState: resourceStateForDesign(designId),
              ...(baseUrl !== undefined ? { baseUrl } : {}),
              wire: active.wire,
              ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
              ...(allowKeyless ? { allowKeyless: true } : {}),
              signal: controller.signal,
              logger: coreLogger,
            },
            id,
            designId,
            payload.previousHtml ?? null,
            workspaceRoot,
            {
              onAggressivePrune: () => {
                aggressivePruneDetected = true;
              },
              onComplete: (messages) => {
                capturedMessages = messages;
              },
            },
          );
          logIpc.info('generate.ok', {
            generationId: id,
            ms: Date.now() - t0,
            artifacts: result.artifacts.length,
            cost: result.costUsd,
          });
          if (capturedMessages !== null) {
            const design = db !== null ? getDesign(db, designId) : null;
            const memoryUpdate = triggerMemoryUpdate({
              workspacePath: workspaceRoot,
              designId,
              designName: design?.name ?? 'Untitled',
              conversationMessages: capturedMessages,
              model: active.model,
              apiKey,
              db,
              ...(baseUrl !== undefined ? { baseUrl } : {}),
              wire: active.wire,
              ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
              ...(allowKeyless ? { allowKeyless: true } : {}),
            }).catch((err) => {
              logIpc.warn('memory.update.fail', {
                generationId: id,
                message: err instanceof Error ? err.message : String(err),
              });
            });

            if (aggressivePruneDetected) {
              await memoryUpdate;
            }
          }
          if (memoryLoadWarning !== undefined) {
            return {
              ...result,
              warnings: [...(result.warnings ?? []), memoryLoadWarning],
            };
          }
          return result;
        } catch (err) {
          // Attach upstream metadata so the renderer's diagnostic pipeline can
          // map this failure to a hypothesis (status, baseUrl, wire, provider).
          const upstreamStatus = extractUpstreamHttpStatus(err);
          if (err !== null && typeof err === 'object') {
            const errAsRec = err as Record<string, unknown>;
            if (upstreamStatus !== undefined && errAsRec['upstream_status'] === undefined) {
              errAsRec['upstream_status'] = upstreamStatus;
            }
            if (errAsRec['upstream_provider'] === undefined) {
              errAsRec['upstream_provider'] = active.model.provider;
            }
            if (errAsRec['upstream_baseurl'] === undefined && baseUrl !== undefined) {
              errAsRec['upstream_baseurl'] = baseUrl;
            }
            if (errAsRec['upstream_wire'] === undefined && active.wire !== undefined) {
              errAsRec['upstream_wire'] = active.wire;
            }
          }
          // The SDK catches our AbortController and rethrows a generic
          // `'Request was aborted.'` that drops signal.reason. Prefer the
          // CodesignError we stashed on the signal so the user sees the
          // configured timeout + Settings path instead of an opaque message.
          const timeoutErr = extractGenerationTimeoutError(controller.signal);
          const rethrow = timeoutErr ?? err;
          logIpc.error('generate.fail', {
            generationId: id,
            ms: Date.now() - t0,
            provider: active.model.provider,
            modelId: active.model.modelId,
            baseUrl: baseUrl ?? '<default>',
            status: upstreamStatus,
            message: rethrow instanceof Error ? rethrow.message : String(rethrow),
            code: rethrow instanceof CodesignError ? rethrow.code : undefined,
          });
          recordFinalError('generate', id, rethrow);
          throw rethrow;
        } finally {
          clearTimeoutGuard();
        }
      });
    });
  });

  ipcMain.handle('codesign:v1:cancel-generation', (_e, raw: unknown) => {
    const { generationId } = CancelGenerationPayloadV1.parse(raw);
    cancelGenerationRequest(generationId, inFlight, logIpc);
  });

  ipcMain.handle('codesign:apply-comment', async (_e, raw: unknown) => {
    const payload = ApplyCommentPayload.parse(raw);
    const id = payload.generationId;
    return withRun(id, async () => {
      const controller = new AbortController();
      return withInFlightGeneration(id, inFlight, controller, async () => {
        const coreLogger = coreLoggerFor(id);

        const cfg = getCachedConfig();
        if (cfg === null) {
          throw new CodesignError(
            'No configuration found. Complete onboarding first.',
            'CONFIG_MISSING',
          );
        }
        // Inline-comment edits don't need to be tied to whatever provider was
        // pinned in the original generate; resolve fresh against the canonical
        // active provider so a switch in Settings takes effect immediately.
        const hint = payload.model ?? { provider: cfg.provider, modelId: cfg.modelPrimary };
        const active = resolveActiveModel(cfg, hint);
        const allowKeyless = active.allowKeyless;
        const apiKey = await resolveApiKeyForActive(active.model.provider, allowKeyless);
        const baseUrl = active.baseUrl ?? undefined;

        const { workspaceRoot } = requireWorkspaceRootForDesign(payload.designId);

        const promptContext = await preparePromptContext({
          attachments: payload.attachments,
          referenceUrl: payload.referenceUrl,
          designSystem: cfg.designSystem ?? null,
          workspaceRoot,
        });

        logIpc.info('applyComment', {
          generationId: id,
          designId: payload.designId,
          provider: active.model.provider,
          modelId: active.model.modelId,
          ...(active.overridden
            ? { requestedProvider: hint.provider, requestedModelId: hint.modelId }
            : {}),
          selector: payload.selection.selector,
          attachmentCount: payload.attachments.length,
          hasReferenceUrl: payload.referenceUrl !== undefined,
          hasDesignSystem: promptContext.designSystem !== null,
          baseUrl: baseUrl ?? '<default>',
        });

        const systemPrompt = composeSystemPrompt({ mode: 'revise' });
        const userPrompt = buildApplyCommentUserPrompt({
          comment: payload.comment,
          selection: payload.selection,
        });

        const t0 = Date.now();
        let clearTimeoutGuard: () => void = () => {};
        try {
          clearTimeoutGuard = await armTimeout(id, controller);
          const isCodex = active.model.provider === CHATGPT_CODEX_PROVIDER_ID;
          const result = await runGenerate(
            {
              prompt: userPrompt,
              systemPrompt,
              history: [],
              model: active.model,
              apiKey,
              ...(isCodex
                ? { getApiKey: () => resolveActiveApiKeyFromState(active.model.provider) }
                : {}),
              attachments: promptContext.attachments,
              referenceUrl: promptContext.referenceUrl,
              designSystem: promptContext.designSystem ?? null,
              projectContext: promptContext.projectContext,
              initialResourceState: resourceStateForDesign(payload.designId),
              ...(baseUrl !== undefined ? { baseUrl } : {}),
              wire: active.wire,
              ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
              ...(allowKeyless ? { allowKeyless: true } : {}),
              signal: controller.signal,
              logger: coreLogger,
            },
            id,
            payload.designId,
            payload.html,
            workspaceRoot,
          );
          logIpc.info('applyComment.ok', {
            generationId: id,
            ms: Date.now() - t0,
            artifacts: result.artifacts.length,
            cost: result.costUsd,
          });
          return result;
        } catch (err) {
          const timeoutErr = extractGenerationTimeoutError(controller.signal);
          const rethrow = timeoutErr ?? err;
          logIpc.error('applyComment.fail', {
            generationId: id,
            ms: Date.now() - t0,
            provider: active.model.provider,
            modelId: active.model.modelId,
            selector: payload.selection.selector,
            message: rethrow instanceof Error ? rethrow.message : String(rethrow),
            code: rethrow instanceof CodesignError ? rethrow.code : undefined,
          });
          recordFinalError('apply-comment', id, rethrow);
          throw rethrow;
        } finally {
          clearTimeoutGuard();
        }
      });
    });
  });

  ipcMain.handle('codesign:v1:generate-title', async (_e, raw: unknown): Promise<string> => {
    const runId = crypto.randomUUID();
    return withRun(runId, async () => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError('generate-title expects an object payload', 'IPC_BAD_INPUT');
      }
      const prompt = (raw as { prompt?: unknown }).prompt;
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new CodesignError('generate-title requires a non-empty prompt', 'IPC_BAD_INPUT');
      }
      const cfg = getCachedConfig();
      if (cfg === null) throw new CodesignError('No configuration', 'CONFIG_MISSING');
      const active = resolveActiveModel(cfg, {
        provider: cfg.activeProvider,
        modelId: cfg.activeModel,
      });
      const allowKeyless = active.allowKeyless;
      const apiKey = await resolveApiKeyForActive(active.model.provider, allowKeyless);
      const baseUrl = active.baseUrl ?? undefined;
      const titleLogger: CoreLogger = {
        info: (event, data) => logIpc.info(event, data),
        warn: (event, data) => logIpc.warn(event, data),
        error: (event, data) => logIpc.error(event, data),
      };
      try {
        return await generateTitle({
          prompt,
          model: active.model,
          apiKey,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          wire: active.wire,
          ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
          ...(allowKeyless ? { allowKeyless: true } : {}),
          logger: titleLogger,
        });
      } catch (err) {
        logIpc.error('[title] generate-title.fail', {
          provider: active.model.provider,
          modelId: active.model.modelId,
          baseUrl,
          message: err instanceof Error ? err.message : String(err),
          code: err instanceof CodesignError ? err.code : undefined,
        });
        recordFinalError('title', runId, err);
        throw err;
      }
    });
  });

  return () => {
    for (const controller of inFlight.values()) {
      try {
        controller.abort();
      } catch {
        // controller may already be settled
      }
    }
    inFlight.clear();
  };
}
