import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AgentEvent,
  type CoreLogger,
  DESIGN_SKILLS,
  FRAME_TEMPLATES,
  applyComment,
  generate,
  generateTitle,
  generateViaAgent,
} from '@open-codesign/core';
import { detectProviderFromKey } from '@open-codesign/providers';
import {
  ApplyCommentPayload,
  BRAND,
  CancelGenerationPayloadV1,
  CodesignError,
  GeneratePayload,
  GeneratePayloadV1,
} from '@open-codesign/shared';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { AgentStreamEvent } from '../preload/index';
import { registerChatMessagesIpc, registerChatMessagesUnavailableIpc } from './chat-messages-ipc';
import { runCodexGenerate } from './codex-generate';
import { registerCodexOAuthIpc } from './codex-oauth-ipc';
import { registerCommentsIpc, registerCommentsUnavailableIpc } from './comments-ipc';
import { registerConnectionIpc } from './connection-ipc';
import { scanDesignSystem } from './design-system';
import { registerDiagnosticsIpc } from './diagnostics-ipc';
import { makeRuntimeVerifier } from './done-verify';
import { BrowserWindow, app, dialog, ipcMain, shell } from './electron-runtime';
import { registerExporterIpc } from './exporter-ipc';
import { armGenerationTimeout, cancelGenerationRequest } from './generation-ipc';
import { maybeAbortIfRunningFromDmg } from './install-check';
import { registerLocaleIpc } from './locale-ipc';
import { getLogPath, getLogger, initLogger } from './logger';
import {
  getApiKeyForProvider,
  getCachedConfig,
  getOnboardingState,
  loadConfigOnBoot,
  registerOnboardingIpc,
  setDesignSystem,
} from './onboarding-ipc';
import { readPersisted as readPreferences, registerPreferencesIpc } from './preferences-ipc';
import { preparePromptContext } from './prompt-context';
import { resolveActiveModel } from './provider-settings';
import { safeInitSnapshotsDb } from './snapshots-db';
import { registerSnapshotsIpc, registerSnapshotsUnavailableIpc } from './snapshots-ipc';
import { initStorageSettings } from './storage-settings';

// ESM shim: package.json "type": "module" means the built bundle is ESM and
// __dirname/__filename don't exist. Derive them from import.meta.url so the
// existing join(__dirname, '../preload/...') calls keep working.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: ElectronBrowserWindow | null = null;

const defaultUserDataDir = app.getPath('userData');
const storageLocations = initStorageSettings(defaultUserDataDir);
if (storageLocations.dataDir !== undefined) {
  mkdirSync(storageLocations.dataDir, { recursive: true });
  app.setPath('userData', storageLocations.dataDir);
}

/**
 * Workstream B Phase 1 feature flag. When truthy, `codesign:*:generate` routes
 * through `generateViaAgent()` (pi-agent-core, zero tools). Default off — any
 * other value (including unset / empty) keeps the legacy `generate()` path.
 *
 * Read once at module init: changing the env var mid-session requires an app
 * restart, which matches every other flag we expose today.
 */
const USE_AGENT_RUNTIME = (() => {
  const raw = process.env['USE_AGENT_RUNTIME'];
  // Default ON: we want the tool-loop path by default now that text streaming
  // and the text_editor + set_todos tools are wired. Explicitly opt out with
  // `USE_AGENT_RUNTIME=0` or `=false` to fall back to the single-turn
  // generate() path.
  if (raw === '0' || raw === 'false') return false;
  return true;
})();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: BRAND.backgroundColor,
    icon: join(__dirname, '../../resources/icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpcHandlers(): void {
  const logIpc = getLogger('main:ipc');

  if (USE_AGENT_RUNTIME) {
    logIpc.info('generate.runtime.agent_enabled', {
      env: 'USE_AGENT_RUNTIME',
      phase: 1,
    });
  }

  /** Adapter so `core` can log step events through the same scoped electron-log
   * sink the IPC handler uses. Keeps a single timeline per generation in the
   * log file without forcing `core` to depend on electron-log. */
  const coreLoggerFor = (id: string): CoreLogger => ({
    info: (event, data) => logIpc.info(event, { generationId: id, ...(data ?? {}) }),
    error: (event, data) => logIpc.error(event, { generationId: id, ...(data ?? {}) }),
  });

  /**
   * Phase 1 flag dispatcher. When `USE_AGENT_RUNTIME` is off, passes through
   * to `generate()` unchanged. When on, routes through `generateViaAgent()`
   * and forwards normalized `AgentEvent`s to the renderer via
   * `agent:event:v1` so the sidebar chat can render incremental output
   * instead of waiting for the full final message.
   */
  const runGenerate = (
    input: Parameters<typeof generate>[0],
    id: string,
    designId: string | null,
    previousHtml: string | null,
  ): ReturnType<typeof generate> => {
    if (!USE_AGENT_RUNTIME) return generate(input);
    const sendEvent = (event: AgentStreamEvent) => {
      mainWindow?.webContents.send('agent:event:v1', event);
    };
    const baseCtx = { designId: designId ?? '', generationId: id } as const;
    const toolStartedAt = new Map<string, number>();
    const runtimeVerify = makeRuntimeVerifier();

    // In-memory virtual FS for the text_editor tool. Scoped to this
    // generation — fresh Map per run. Seeded with the design's current
    // HTML under index.html so the agent can view/edit incrementally.
    const fsMap = new Map<string, string>();
    if (previousHtml && previousHtml.trim().length > 0) {
      fsMap.set('index.html', previousHtml);
    }
    // Seed the virtual fs with optional device-frame starter templates. The
    // agent decides whether to view/use them based on the brief — there is
    // no keyword detection here. See packages/core/src/frames/README.md.
    for (const [name, content] of FRAME_TEMPLATES) {
      fsMap.set(`frames/${name}`, content);
    }
    // Same shape for design-skill snippets — `view skills/<name>.md` to learn
    // a reusable pattern, then adapt. Pure progressive disclosure: model
    // decides, no keyword router. See packages/core/src/design-skills/.
    for (const [name, content] of DESIGN_SKILLS) {
      fsMap.set(`skills/${name}`, content);
    }
    const fs = {
      view(path: string) {
        const content = fsMap.get(path);
        if (content === undefined) return null;
        return { content, numLines: content.split('\n').length };
      },
      create(path: string, content: string) {
        fsMap.set(path, content);
        emitFsUpdated(path, content);
        return { path };
      },
      strReplace(path: string, oldStr: string, newStr: string) {
        const current = fsMap.get(path);
        if (current === undefined) throw new Error(`File not found: ${path}`);
        const idx = current.indexOf(oldStr);
        if (idx === -1) throw new Error(`old_str not found in ${path}`);
        if (current.indexOf(oldStr, idx + oldStr.length) !== -1) {
          throw new Error(`old_str is ambiguous in ${path}; provide more context`);
        }
        const next = current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
        fsMap.set(path, next);
        emitFsUpdated(path, next);
        return { path };
      },
      insert(path: string, line: number, text: string) {
        const current = fsMap.get(path) ?? '';
        const lines = current.split('\n');
        const clamped = Math.max(0, Math.min(line, lines.length));
        lines.splice(clamped, 0, text);
        const next = lines.join('\n');
        fsMap.set(path, next);
        emitFsUpdated(path, next);
        return { path };
      },
      listDir(dir: string) {
        const prefix = dir.length === 0 || dir === '.' ? '' : `${dir.replace(/\/+$/, '')}/`;
        const entries = new Set<string>();
        for (const p of fsMap.keys()) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          const firstSegment = rest.split('/')[0];
          if (firstSegment) entries.add(firstSegment);
        }
        return [...entries].sort();
      },
    };

    // Fan virtual-fs writes to the renderer so the iframe can re-render the
    // artifact in near real time. Routed through the existing agent:event:v1
    // channel as a `fs_updated` variant — single-channel keeps ordering with
    // tool_call_start/end. Skip emission when the run isn't tied to a design
    // (no preview pane to update).
    function emitFsUpdated(path: string, content: string): void {
      if (designId === null) return;
      sendEvent({ ...baseCtx, type: 'fs_updated', path, content });
    }

    // Per-turn counters so we can emit a single summary line at turn_end
    // instead of a log per token delta.
    let deltaCount = 0;
    let toolCount = 0;

    return generateViaAgent(input, {
      fs,
      runtimeVerify,
      onEvent: (event: AgentEvent) => {
        // High-signal only. Skip per-token deltas and inner message_*
        // markers. Emit a concise summary at turn_end.
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
          logIpc.info('agent.turn_end', { generationId: id, deltas: deltaCount, tools: toolCount });
        } else if (event.type === 'agent_end') {
          logIpc.info('agent.end', { generationId: id });
        }
        if (designId === null) return; // no routing target
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
          const finalText = rawText.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim();
          sendEvent({ ...baseCtx, type: 'turn_end', finalText });
          return;
        }
        if (event.type === 'agent_end') {
          // Final boundary of an agent run — renderer uses this to persist a
          // SQLite snapshot from the in-memory previewHtml so the design
          // survives an app restart. Without this the next switchDesign() at
          // boot finds no snapshot and falls back to the empty welcome state.
          sendEvent({ ...baseCtx, type: 'agent_end' });
          return;
        }
      },
    });
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
  // The agent itself uses the same verifier as an injected callback (see
  // runGenerate above), so this handler is NOT in the hot path. Hidden
  // BrowserWindow + Babel makes vitest unworkable here — manual verification
  // path documented in done-verify.ts.
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

  ipcMain.handle('codesign:pick-input-files', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile', 'multiSelections'],
        })
      : await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
        });
    if (result.canceled || result.filePaths.length === 0) return [];
    return Promise.all(
      result.filePaths.map(async (path) => {
        try {
          const info = await stat(path);
          return { path, name: basename(path), size: info.size };
        } catch {
          return { path, name: basename(path), size: 0 };
        }
      }),
    );
  });

  ipcMain.handle('codesign:pick-design-system-directory', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });
    if (result.canceled || result.filePaths.length === 0) return getOnboardingState();
    const rootPath = result.filePaths[0];
    if (!rootPath) return getOnboardingState();
    logIpc.info('designSystem.scan.start', { rootPath });
    const snapshot = await scanDesignSystem(rootPath);
    const nextState = await setDesignSystem(snapshot);
    logIpc.info('designSystem.scan.ok', {
      rootPath,
      sourceFiles: snapshot.sourceFiles.length,
      colors: snapshot.colors.length,
      fonts: snapshot.fonts.length,
    });
    return nextState;
  });

  ipcMain.handle('codesign:clear-design-system', async () => {
    const nextState = await setDesignSystem(null);
    logIpc.info('designSystem.clear');
    return nextState;
  });

  ipcMain.handle('codesign:v1:generate', async (_e, raw: unknown) => {
    const payload = GeneratePayloadV1.parse(raw);
    const controller = new AbortController();
    const id = payload.generationId;
    inFlight.set(id, controller);
    const coreLogger = coreLoggerFor(id);

    coreLogger.info('[generate] step=load_config');
    const loadStart = Date.now();
    const cfg = getCachedConfig();
    if (cfg === null) {
      inFlight.delete(id);
      throw new CodesignError(
        'No configuration found. Complete onboarding first.',
        'CONFIG_MISSING',
      );
    }
    // Snap to the canonical active provider in cachedConfig — the SAME source
    // the Settings UI uses for the Active badge — so the actual call cannot
    // diverge from what the user sees.
    const active = resolveActiveModel(cfg, payload.model);
    let apiKey: string;
    try {
      apiKey = getApiKeyForProvider(active.model.provider);
    } catch {
      apiKey = '';
    }
    const allowKeyless = active.allowKeyless;
    // Once we've snapped to the canonical active provider, the renderer-supplied
    // baseUrl can no longer be trusted — it may belong to a different (stale)
    // provider and would route the active provider's API key to the wrong host.
    // Always use the per-provider baseUrl from cached config, and mutate the
    // payload itself so any downstream reader cannot accidentally pick up the
    // stale renderer value.
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
    const isChatgptCodex = active.model.provider === 'chatgpt-codex';
    if (apiKey.length === 0 && !allowKeyless && !isChatgptCodex) {
      coreLogger.error('[generate] step=validate_provider.fail', {
        provider: active.model.provider,
        reason: 'missing_api_key',
      });
      inFlight.delete(id);
      throw new CodesignError(
        `No API key configured for provider "${active.model.provider}". Open Settings to add one.`,
        'PROVIDER_AUTH_MISSING',
      );
    }
    coreLogger.info('[generate] step=validate_provider.ok', { provider: active.model.provider });

    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

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
      if (isChatgptCodex) {
        const codex = await runCodexGenerate({
          prompt: payload.prompt,
          history: payload.history,
          model: active.model,
          attachments: promptContext.attachments,
          referenceUrl: promptContext.referenceUrl ?? null,
          designSystem: promptContext.designSystem ?? null,
          signal: controller.signal,
          logger: coreLogger,
        });
        const result = {
          message: codex.rawOutput,
          artifacts: codex.artifacts,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          ...(codex.issues.length > 0 ? { warnings: codex.issues } : {}),
        };
        logIpc.info('generate.ok', {
          generationId: id,
          ms: Date.now() - t0,
          artifacts: result.artifacts.length,
          cost: result.costUsd,
          via: 'codex',
        });
        return result;
      }
      const result = await runGenerate(
        {
          prompt: payload.prompt,
          history: payload.history,
          model: active.model,
          apiKey,
          attachments: promptContext.attachments,
          referenceUrl: promptContext.referenceUrl,
          designSystem: promptContext.designSystem ?? null,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          wire: active.wire,
          ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
          ...(allowKeyless ? { allowKeyless: true } : {}),
          signal: controller.signal,
          logger: coreLogger,
        },
        id,
        payload.designId ?? null,
        payload.previousHtml ?? null,
      );
      logIpc.info('generate.ok', {
        generationId: id,
        ms: Date.now() - t0,
        artifacts: result.artifacts.length,
        cost: result.costUsd,
      });
      return result;
    } catch (err) {
      logIpc.error('generate.fail', {
        generationId: id,
        ms: Date.now() - t0,
        provider: active.model.provider,
        modelId: active.model.modelId,
        baseUrl: baseUrl ?? '<default>',
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof CodesignError ? err.code : undefined,
      });
      throw err;
    } finally {
      clearTimeoutGuard();
      inFlight.delete(id);
    }
  });

  // Legacy shim — kept for one minor release while older renderer builds still
  // send codesign:generate without schemaVersion. Remove after v0.3.
  ipcMain.handle('codesign:generate', async (_e, raw: unknown) => {
    logIpc.warn('legacy codesign:generate channel used, schedule removal next minor');
    const legacy = GeneratePayload.parse(raw);
    const id = legacy.generationId ?? `gen-${Date.now()}`;
    const v1Raw = { schemaVersion: 1 as const, ...legacy, generationId: id };
    const payload = GeneratePayloadV1.parse(v1Raw);
    const controller = new AbortController();
    inFlight.set(id, controller);

    const cfg = getCachedConfig();
    if (cfg === null) {
      inFlight.delete(id);
      throw new CodesignError(
        'No configuration found. Complete onboarding first.',
        'CONFIG_MISSING',
      );
    }
    const active = resolveActiveModel(cfg, payload.model);
    let apiKey: string;
    try {
      apiKey = getApiKeyForProvider(active.model.provider);
    } catch {
      apiKey = '';
    }
    const allowKeyless = active.allowKeyless;
    // See codesign:v1:generate above — renderer baseUrl is ignored post-snap.
    const baseUrl = active.baseUrl ?? undefined;
    if (active.overridden) {
      payload.baseUrl = baseUrl;
    }
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

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
      const result = await runGenerate(
        {
          prompt: payload.prompt,
          history: payload.history,
          model: active.model,
          apiKey,
          attachments: promptContext.attachments,
          referenceUrl: promptContext.referenceUrl,
          designSystem: promptContext.designSystem ?? null,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          wire: active.wire,
          ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
          ...(allowKeyless ? { allowKeyless: true } : {}),
          signal: controller.signal,
        },
        id,
        null,
        null,
      );
      logIpc.info('generate.ok', {
        generationId: id,
        ms: Date.now() - t0,
        artifacts: result.artifacts.length,
        cost: result.costUsd,
      });
      return result;
    } catch (err) {
      logIpc.error('generate.fail', {
        generationId: id,
        ms: Date.now() - t0,
        provider: active.model.provider,
        modelId: active.model.modelId,
        baseUrl: baseUrl ?? '<default>',
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof CodesignError ? err.code : undefined,
      });
      throw err;
    } finally {
      clearTimeoutGuard();
      inFlight.delete(id);
    }
  });

  ipcMain.handle('codesign:v1:cancel-generation', (_e, raw: unknown) => {
    const { generationId } = CancelGenerationPayloadV1.parse(raw);
    cancelGenerationRequest(generationId, inFlight, logIpc);
  });

  ipcMain.handle('codesign:apply-comment', async (_e, raw: unknown) => {
    const payload = ApplyCommentPayload.parse(raw);
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
    let apiKey: string;
    try {
      apiKey = getApiKeyForProvider(active.model.provider);
    } catch {
      apiKey = '';
    }
    const allowKeyless = active.allowKeyless;
    const baseUrl = active.baseUrl ?? undefined;
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

    logIpc.info('applyComment', {
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

    const t0 = Date.now();
    try {
      const result = await applyComment({
        html: payload.html,
        comment: payload.comment,
        selection: payload.selection,
        model: active.model,
        apiKey,
        attachments: promptContext.attachments,
        referenceUrl: promptContext.referenceUrl,
        designSystem: promptContext.designSystem ?? null,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        wire: active.wire,
        ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
        ...(allowKeyless ? { allowKeyless: true } : {}),
      });
      logIpc.info('applyComment.ok', {
        ms: Date.now() - t0,
        artifacts: result.artifacts.length,
        cost: result.costUsd,
      });
      return result;
    } catch (err) {
      logIpc.error('applyComment.fail', {
        ms: Date.now() - t0,
        provider: active.model.provider,
        modelId: active.model.modelId,
        selector: payload.selection.selector,
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof CodesignError ? err.code : undefined,
      });
      throw err;
    }
  });

  ipcMain.handle('codesign:v1:generate-title', async (_e, raw: unknown): Promise<string> => {
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
    let apiKey: string;
    try {
      apiKey = getApiKeyForProvider(active.model.provider);
    } catch {
      apiKey = '';
    }
    const allowKeyless = active.allowKeyless;
    const baseUrl = active.baseUrl ?? undefined;
    const titleLogger: CoreLogger = {
      info: (event, data) => logIpc.info(event, data),
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
      throw err;
    }
  });

  ipcMain.handle('codesign:open-log-folder', async () => {
    await shell.openPath(getLogPath());
  });
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('codesign:update-available', info);
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('codesign:update-error', err.message);
  });
  ipcMain.handle('codesign:check-for-updates', () => autoUpdater.checkForUpdates());
  ipcMain.handle('codesign:download-update', () => autoUpdater.downloadUpdate());
  ipcMain.handle('codesign:install-update', () => autoUpdater.quitAndInstall());
}

void app.whenReady().then(async () => {
  initLogger();
  // Show a blocking dialog if the user launched from the DMG mount. If
  // they accept the remedy, we quit here before touching safeStorage / the
  // snapshots DB so nothing half-initialises against a bad install.
  const aborted = await maybeAbortIfRunningFromDmg();
  if (aborted) return;
  await loadConfigOnBoot();
  // Snapshot persistence is best-effort at boot — a failure here (corrupt DB,
  // permission denied, missing native binding) must NOT block the BrowserWindow
  // from opening. Surface it via an error dialog and skip registering the
  // snapshots IPC channels; the rest of the app stays usable.
  const dbResult = safeInitSnapshotsDb(join(app.getPath('userData'), 'designs.db'));
  if (dbResult.ok) {
    registerSnapshotsIpc(dbResult.db);
    registerChatMessagesIpc(dbResult.db);
    registerCommentsIpc(dbResult.db);
  } else {
    const bootLog = getLogger('main:boot');
    bootLog.error('snapshotsDb.init.fail', {
      message: dbResult.error.message,
      stack: dbResult.error.stack,
    });
    // Install stub handlers so renderer-side calls reject with a typed
    // SNAPSHOTS_UNAVAILABLE CodesignError instead of Electron's opaque
    // "No handler registered" rejection — see snapshots-ipc.ts.
    registerSnapshotsUnavailableIpc(dbResult.error.message);
    registerChatMessagesUnavailableIpc(dbResult.error.message);
    registerCommentsUnavailableIpc(dbResult.error.message);
    dialog.showErrorBox(
      'Design history unavailable',
      `Could not open the local snapshots database. Version history will be disabled for this session.\n\n${dbResult.error.message}`,
    );
  }
  registerIpcHandlers();
  registerLocaleIpc();
  registerConnectionIpc();
  registerOnboardingIpc();
  registerCodexOAuthIpc();
  registerPreferencesIpc();
  registerExporterIpc(() => mainWindow);
  registerDiagnosticsIpc();
  setupAutoUpdater();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
