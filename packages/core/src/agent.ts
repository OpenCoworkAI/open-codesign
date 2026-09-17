/**
 * Agent runtime wrapper — the live generate path in v0.2.
 *
 * Routes a `generate()`-shaped request through `@mariozechner/pi-agent-core`
 * with the v0.2 design tool set (set_title, set_todos,
 * str_replace_based_edit_tool, done, generate_image_asset, skill, scaffold,
 * preview, tweaks, ask — see `defaultTools` below). Streams `turn_start` /
 * `message_update` / `turn_end` lifecycle events through `onEvent` so the
 * renderer can drive the chat/preview UI.
 *
 * pi-agent-core quirks worth remembering:
 *   - `Agent` does NOT accept `model` / `systemPrompt` / `tools` as top-level
 *     constructor args. They live in `options.initialState`.
 *   - There is no `agent.run()` returning `{finalText, usage}`. We call
 *     `agent.prompt(userMessage)` (Promise<void>) and read the final
 *     assistant message + usage from `agent.state.messages` after settlement.
 *   - The stream delta event is `message_update` with
 *     `assistantMessageEvent.type === 'text_delta'`, not a top-level
 *     `text_delta` event.
 */

import path from 'node:path';
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
} from '@mariozechner/pi-agent-core';
import type {
  ImageContent as PiAiImageContent,
  Message as PiAiMessage,
  Model as PiAiModel,
} from '@mariozechner/pi-ai';
import type { RetryDecision, RetryReason } from '@open-codesign/providers';
import {
  classifyError,
  claudeCodeIdentityHeaders,
  inferReasoning,
  isProviderAbortedTransportError,
  isTransportLevelError,
  looksLikeClaudeOAuthToken,
  normalizeGeminiModelId,
  shouldForceClaudeCodeIdentity,
  withBackoff,
} from '@open-codesign/providers';
import {
  type ChatMessage,
  CodesignError,
  canonicalBaseUrl,
  DEFAULT_SOURCE_ENTRY,
  type DesignRunPreferencesV1,
  ERROR_CODES,
  formatDesignMdForPrompt,
  LEGACY_SOURCE_ENTRY,
  type ModelRef,
  type ResourceStateV1,
  validateDesignMd,
  type WireApi,
} from '@open-codesign/shared';
import type { TSchema } from '@sinclair/typebox';
import type { ActiveRunMessages } from './active-messages.js';
import { buildTransformContext } from './context-prune.js';
import { remapProviderError } from './errors.js';
import type { GenerateInput, GenerateOutput } from './index.js';
import { reasoningForModel } from './index.js';
import {
  type Collected,
  createDesignSourceArtifact,
  stripEmptyFences,
} from './lib/artifact-collect.js';
import {
  buildContextSections,
  buildUserPromptWithContext,
  formatProjectDesignSystemContext,
  formatProjectInstructionsContext,
  formatProjectSettingsContext,
  formatUntrustedContext,
} from './lib/context-format.js';
import { NOOP_LOGGER } from './logger.js';
import type {
  PromptFeatureConfidence,
  PromptFeatureMode,
  PromptFeatureProfile,
  PromptFeatureProvenance,
  PromptFeatureSetting,
} from './prompts/compose-full.js';
import { composeSystemPrompt } from './prompts/index.js';
import { collectResourceManifest } from './resource-manifest.js';
import {
  assertFinalizationGate,
  cloneResourceState,
  recordDone,
  recordLoadedResource,
  recordMutation,
  recordScaffold,
} from './resource-state.js';
import { buildRunProtocolPreflight, type RunProtocolState } from './run-protocol.js';
import { availableToolNames } from './tool-manifest.js';
import { makeAskTool } from './tools/ask.js';
import { makeDecomposeToUiKitTool } from './tools/decompose-to-ui-kit.js';
import { type DoneDetails, type DoneRuntimeVerifier, makeDoneTool } from './tools/done.js';
import {
  type GenerateImageAssetFn,
  makeGenerateImageAssetTool,
} from './tools/generate-image-asset.js';
import { makeInspectWorkspaceTool } from './tools/inspect-workspace.js';
import { makePreviewTool } from './tools/preview.js';
import { makeScaffoldTool, type ScaffoldDetails } from './tools/scaffold.js';
import { makeSetTitleTool } from './tools/set-title.js';
import { makeSetTodosTool } from './tools/set-todos.js';
import { makeSkillTool } from './tools/skill.js';
import { makeTextEditorTool, type TextEditorFsCallbacks } from './tools/text-editor.js';
import { makeTweaksTool } from './tools/tweaks.js';
import { makeVerifyUiKitParityTool } from './tools/verify-ui-kit-parity.js';
import {
  type JudgeVisualParityFn,
  makeVerifyUiKitVisualParityTool,
  type RenderUiKitFn,
} from './tools/verify-ui-kit-visual-parity.js';

/** Local mirror of the assistant message shape that pi-agent-core emits (via
 *  pi-ai). Declared here so this file does not take a direct dependency on
 *  `@mariozechner/pi-ai`'s types; keep this shape in lockstep with the real
 *  pi-ai `AssistantMessage` whenever pi-agent-core is upgraded. */
interface PiAssistantMessage {
  role: 'assistant';
  content: Array<{ type: string; text?: string }>;
  api: string;
  provider: string;
  model: string;
  usage?: {
    input?: number;
    output?: number;
    cost?: { total?: number };
  };
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  errorMessage?: string;
  timestamp: number;
}

// Prompt assembly and artifact collection helpers live in ./lib/context-format.ts
// and ./lib/artifact-collect.ts (shared with index.ts).
//
// Note: extractLooseArtifact / extractHtmlDocument were removed in favour of
// str_replace_based_edit_tool + virtual fs. See
// `if (collected.artifacts.length === 0 && deps.fs)` below for the only
// supported recovery.

// ---------------------------------------------------------------------------
// Model resolution — unified single path. We never query pi-ai's registry;
// instead we build the pi-ai Model shape directly from `cfg.providers[id]`
// (wire + baseUrl + modelId). This means:
//   - builtin providers (anthropic/openai/openrouter) take the same path as
//     imported ones (claude-code-imported, codex-*, custom proxies)
//   - there is no "unknown model" error — a missing entry is a config bug
//     the caller must surface, not an error to swallow
//   - cost / context-window metadata comes from pi-ai's registry historically,
//     but the user has opted to drop cost display, so we use optimistic
//     defaults (cost 0) that do not block requests
// ---------------------------------------------------------------------------

interface PiModel {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  compat?: {
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    supportsStore?: boolean;
    supportsStrictMode?: boolean;
    maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  };
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResponsesReasoningItem(value: unknown): boolean {
  return isRecord(value) && value['type'] === 'reasoning';
}

export function sanitizeOpenAIResponsesPayloadForStoreFalse(payload: unknown): unknown {
  if (!isRecord(payload) || payload['store'] !== false || !Array.isArray(payload['input'])) {
    return payload;
  }
  return {
    ...payload,
    input: payload['input'].filter((entry) => !isResponsesReasoningItem(entry)),
  };
}

function apiForWire(wire: WireApi | undefined): string {
  if (wire === 'anthropic') return 'anthropic-messages';
  if (wire === 'openai-responses') return 'openai-responses';
  if (wire === 'openai-codex-responses') return 'openai-codex-responses';
  // openai-chat is the canonical wire for everything else that uses the
  // openai chat-completions wire format (openai, openrouter, deepseek, etc.).
  return 'openai-completions';
}

function supportsOpenAIDeveloperRole(wire: WireApi | undefined, baseUrl: string): boolean {
  if (wire !== 'openai-chat') return true;
  const host = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  return host === 'api.openai.com' || host.endsWith('.openai.com') || host === 'openrouter.ai';
}

function openAIChatCompatForBaseUrl(
  wire: WireApi | undefined,
  baseUrl: string,
): PiModel['compat'] | undefined {
  if (wire !== 'openai-chat') return undefined;
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return { supportsDeveloperRole: false };
  }
  if (host === 'api.deepinfra.com' || host.endsWith('.deepinfra.com')) {
    return {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsStrictMode: false,
      maxTokensField: 'max_tokens',
    };
  }
  if (!supportsOpenAIDeveloperRole(wire, baseUrl)) {
    return { supportsDeveloperRole: false };
  }
  return undefined;
}

function supportsImageInput(wire: WireApi | undefined, modelId: string): boolean {
  if (wire === 'anthropic' || wire === 'openai-responses' || wire === 'openai-codex-responses') {
    return true;
  }
  if (wire === 'openai-chat') {
    return true;
  }
  const lower = modelId.toLowerCase();
  return (
    lower.includes('vision') ||
    lower.includes('vl') ||
    lower.includes('multimodal') ||
    lower.includes('gpt-4o') ||
    lower.includes('gpt-5') ||
    lower.includes('claude-3') ||
    lower.includes('claude-sonnet-4') ||
    lower.includes('claude-opus-4')
  );
}

const BUILTIN_PUBLIC_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

function buildPiModel(
  model: ModelRef,
  wire: WireApi | undefined,
  baseUrl: string | undefined,
  httpHeaders?: Record<string, string> | undefined,
  apiKey?: string,
): PiModel {
  // Fall through to the canonical public endpoint for the 3 first-party
  // BYOK providers when the caller omitted baseUrl. This is a fact about
  // those endpoints (api.anthropic.com is anthropic), not a registry lookup for a
  // model registry — imported / custom providers still require baseUrl and
  // will throw if absent.
  const resolvedBaseUrl =
    baseUrl && baseUrl.trim().length > 0
      ? baseUrl
      : (BUILTIN_PUBLIC_BASE_URLS[model.provider] ?? '');
  if (resolvedBaseUrl.length === 0) {
    throw new CodesignError(
      `Provider "${model.provider}" has no baseUrl configured. Add one in Settings or re-import the config.`,
      ERROR_CODES.PROVIDER_BASE_URL_MISSING,
    );
  }
  // Defensive: canonicalize stored baseUrl before handing to pi-ai. Rescues
  // legacy configs that persisted pre-normalization (e.g. raw `/v1/chat/completions`
  // pasted in an older build). No-op for configs saved post-fix.
  // For openai-codex-responses, canonicalBaseUrl only strips trailing slashes
  // — pi-ai's codex wire appends `/codex/responses` from the bare base itself.
  const canonicalBase = wire ? canonicalBaseUrl(resolvedBaseUrl, wire) : resolvedBaseUrl;
  const effectiveModelId = normalizeGeminiModelId(model.modelId, canonicalBase);
  const out: PiModel = {
    id: effectiveModelId,
    name: effectiveModelId,
    api: apiForWire(wire),
    provider: model.provider,
    baseUrl: canonicalBase,
    reasoning: inferReasoning(wire, effectiveModelId, canonicalBase),
    input: supportsImageInput(wire, effectiveModelId) ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
  };
  const compat = openAIChatCompatForBaseUrl(wire, canonicalBase);
  if (compat !== undefined) out.compat = compat;
  if (httpHeaders !== undefined) out.headers = httpHeaders;

  // sub2api / claude2api gateways 403 any request without claude-cli
  // identity headers. pi-ai only emits them for sk-ant-oat OAuth tokens —
  // so a custom anthropic baseUrl keyed by a plain token hits the edge WAF.
  // Inject them here too (this path goes through pi-agent-core, which
  // forwards model.headers to pi-ai). User-supplied headers keep precedence.
  // Skip when the key already looks OAuth-shaped: pi-ai's OAuth branch
  // injects the same set, and leaving that the single source keeps us from
  // silently overriding future pi-ai header updates on the OAuth path.
  if (
    shouldForceClaudeCodeIdentity(wire, canonicalBase) &&
    (apiKey === undefined || !looksLikeClaudeOAuthToken(apiKey))
  ) {
    out.headers = { ...claudeCodeIdentityHeaders(), ...(out.headers ?? {}) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tool-use guidance appended to the system prompt when agentic tools are
// active. Keeps the base prompt (shared with the non-agent path) unchanged.
// ---------------------------------------------------------------------------

const MAX_DONE_ERROR_ROUNDS = 3;

function featureMode(mode: DesignRunPreferencesV1['tweaks'] | undefined): PromptFeatureMode {
  if (mode === 'yes') return 'enabled';
  if (mode === 'no') return 'disabled';
  return 'auto';
}

function featureSetting(
  preferences: DesignRunPreferencesV1 | undefined,
  key: 'tweaks' | 'bitmapAssets' | 'reusableSystem',
): PromptFeatureSetting {
  const routing = preferences?.routing?.[key];
  return {
    mode: featureMode(preferences?.[key]),
    provenance: (routing?.provenance ?? 'default') as PromptFeatureProvenance,
    confidence: (routing?.confidence ?? 'low') as PromptFeatureConfidence,
    ...(routing?.reason !== undefined ? { reason: routing.reason } : {}),
  };
}

function featureProfileFromRunPreferences(
  preferences: DesignRunPreferencesV1 | undefined,
): PromptFeatureProfile {
  return {
    tweaks: featureSetting(preferences, 'tweaks'),
    bitmapAssets: featureSetting(preferences, 'bitmapAssets'),
    reusableSystem: featureSetting(preferences, 'reusableSystem'),
    ...(preferences?.visualDirection ? { visualDirection: preferences.visualDirection } : {}),
  };
}

function explicitDisabled(setting: PromptFeatureProfile['tweaks']): boolean {
  return (
    typeof setting !== 'string' &&
    setting.mode === 'disabled' &&
    setting.provenance === 'explicit' &&
    setting.confidence === 'high'
  );
}

function featureModeValue(setting: PromptFeatureProfile['tweaks']): PromptFeatureMode {
  return typeof setting === 'string' ? setting : setting.mode;
}

function isAutoDesignName(name: string | undefined): boolean {
  return name === 'Untitled design' || /^Untitled design \d+$/.test(name ?? '');
}

function autoTitleFromPrompt(prompt: string): string {
  const condensed = prompt.replace(/\s+/g, ' ').trim();
  if (condensed.length === 0) return 'Untitled design';
  return condensed.length > 40 ? `${condensed.slice(0, 40).trimEnd()}…` : condensed;
}

function emitPreflightSetTitle(onEvent: GenerateViaAgentDeps['onEvent'], title: string): void {
  if (!onEvent) return;
  const toolCallId = 'host-set-title';
  onEvent({
    type: 'tool_execution_start',
    toolCallId,
    toolName: 'set_title',
    args: { title },
  } as AgentEvent);
  onEvent({
    type: 'tool_execution_end',
    toolCallId,
    toolName: 'set_title',
    isError: false,
    result: {
      content: [{ type: 'text', text: `Title set: ${title}` }],
      details: { title },
    },
  } as AgentEvent);
}

function todosRequiredResult(
  toolName: string,
): AgentToolResult<{ status: string; reason: string }> {
  return {
    content: [
      {
        type: 'text',
        text: `Call set_todos before editing, previewing, or finishing. Then retry ${toolName}.`,
      },
    ],
    details: { status: 'blocked', reason: 'todos_required' },
  };
}

function wrapTodosState<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
  state: RunProtocolState,
): AgentTool<TParams, TDetails> {
  return {
    ...tool,
    async execute(...args) {
      const result = await tool.execute(...args);
      state.todosSet = true;
      return result;
    },
  };
}

function wrapPlanningGate<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
  state: RunProtocolState,
  options: {
    allowBeforeTodos?: ((params: unknown) => boolean) | undefined;
  } = {},
): AgentTool<TParams, TDetails> {
  return {
    ...tool,
    async execute(...args) {
      if (
        state.requiresTodosBeforeMutation &&
        !state.todosSet &&
        options.allowBeforeTodos?.(args[1]) !== true
      ) {
        return todosRequiredResult(tool.name) as AgentToolResult<TDetails>;
      }
      return await tool.execute(...args);
    },
  };
}

function isTextEditorView(params: unknown): boolean {
  return (
    typeof params === 'object' &&
    params !== null &&
    (params as { command?: unknown }).command === 'view'
  );
}

function imageDataUrlToContent(dataUrl: string): PiAiImageContent | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl.trim());
  if (match === null) return null;
  const mimeType = match[1];
  const data = match[2];
  if (mimeType === undefined || data === undefined || !mimeType.startsWith('image/')) return null;
  return { type: 'image', data, mimeType };
}

function attachmentImagesForModel(input: GenerateInput, model: PiModel): PiAiImageContent[] {
  if (!model.input.includes('image')) return [];
  return (input.attachments ?? []).flatMap((attachment) => {
    if (!attachment.imageDataUrl) return [];
    const image = imageDataUrlToContent(attachment.imageDataUrl);
    return image === null ? [] : [image];
  });
}

function agenticToolGuidance(input: {
  inspectWorkspace: boolean;
  featureProfile: PromptFeatureProfile;
  currentDesignName?: string | undefined;
}): string {
  const titleStep = isAutoDesignName(input.currentDesignName)
    ? 'The title is auto-generated: call `set_title` as the first tool call, before reading or editing.'
    : 'For a fresh design, call `set_title` once; do not rename an existing design unless requested.';
  const tweakStep = explicitDisabled(input.featureProfile.tweaks)
    ? 'Do not call `tweaks()`; the user explicitly declined controls.'
    : featureModeValue(input.featureProfile.tweaks) === 'enabled'
      ? 'After implementing useful source-backed controls, call `tweaks()` if available.'
      : 'When available, decide agentically whether tweak controls improve iteration; inferred preferences are not prohibitions.';
  return [
    '## Host tool contract',
    titleStep,
    '- Use `set_todos` for dependent multi-step work; obey a host-required todo gate before mutation.',
    ...(input.inspectWorkspace
      ? [
          '- When the brief includes workspace files or references, call `inspect_workspace` before editing, then read the relevant files.',
        ]
      : []),
    `- Write the primary visual design source to \`${DEFAULT_SOURCE_ENTRY}\` using \`str_replace_based_edit_tool\`; document-only outputs need no visual shell.`,
    '- Use `create` for new files; follow-up edits use `view`, `str_replace`, or `insert`.',
    '- Before editing an existing file, `view` its current contents in this run. Keep `old_str` small and unique. Successful edits need no redundant readback; inspect when subsequent work needs context.',
    tweakStep,
    '- Use only available tools and their live schemas. Batch independent reads; sequence dependent edits and preview checks.',
    `- After the final relevant source mutation, use \`preview(path)\` when available, then \`done(path)\`. If done reports errors, repair them, but stop after ${MAX_DONE_ERROR_ROUNDS} error rounds and report the unresolved failure.`,
  ].join('\n');
}

const IMAGE_ASSET_TOOL_GUIDANCE = [
  '## Bitmap asset generation',
  '',
  'Use `generate_image_asset` only for named or clearly beneficial bitmap slots: hero, product, poster, background, illustration, or rendered logo.',
  'Inventory required assets and request independent slots together when useful. One named bitmap slot equals one tool call. Only blocking assets should delay the first runnable slice; add supporting assets in later coherent edits.',
  'Use inline SVG/CSS for charts, simple icons, flat geometric marks, gradients, and UI chrome.',
  'Each call needs a production prompt, accurate `purpose`, matching `aspectRatio`, meaningful `alt`, and optional `filenameHint`.',
  'Reference the returned local `assets/...` path from the design source.',
].join('\n');

// ---------------------------------------------------------------------------
// Transport-level retry helpers.
// ---------------------------------------------------------------------------

const MAX_TRANSPORT_RETRIES = 2;

function trackFsMutations(
  fs: TextEditorFsCallbacks,
  resourceState: ResourceStateV1,
  signal?: AbortSignal,
): TextEditorFsCallbacks {
  return {
    view: (path) => fs.view(path),
    listDir: (dir) => fs.listDir(dir),
    async create(path, content) {
      signal?.throwIfAborted();
      const result = await fs.create(path, content);
      recordMutation(resourceState);
      return result;
    },
    async strReplace(path, oldStr, newStr) {
      signal?.throwIfAborted();
      const result = await fs.strReplace(path, oldStr, newStr);
      recordMutation(resourceState);
      return result;
    },
    async insert(path, line, text) {
      signal?.throwIfAborted();
      const result = await fs.insert(path, line, text);
      recordMutation(resourceState);
      return result;
    },
  };
}

function wrapSkillState(
  tool: AgentTool<TSchema, unknown>,
  resourceState: ResourceStateV1,
): AgentTool<TSchema, unknown> {
  return {
    ...tool,
    async execute(...args): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(...args);
      const details = result.details as { name?: unknown; status?: unknown } | undefined;
      if (details?.status === 'loaded' && typeof details.name === 'string') {
        recordLoadedResource(resourceState, details.name);
      }
      return result;
    },
  };
}

function wrapScaffoldState(
  tool: AgentTool<TSchema, unknown>,
  resourceState: ResourceStateV1,
): AgentTool<TSchema, unknown> {
  return {
    ...tool,
    async execute(...args): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(...args);
      const details = result.details as ScaffoldDetails | undefined;
      if (details && 'ok' in details && details.ok === true) {
        recordScaffold(resourceState, {
          kind: details.kind,
          destPath: details.destPath,
          bytes: details.bytes,
        });
      }
      return result;
    },
  };
}

function wrapDoneState(
  tool: AgentTool<TSchema, unknown>,
  resourceState: ResourceStateV1,
  onDone?: ((details: DoneDetails) => void) | undefined,
  progress = { errorRounds: 0 },
): AgentTool<TSchema, unknown> {
  return {
    ...tool,
    executionMode: 'sequential',
    async execute(...args): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(...args);
      const details = result.details as DoneDetails | undefined;
      if (details) {
        onDone?.(details);
        recordDone(resourceState, {
          status: details.status,
          path: details.path,
          errorCount: details.errors.length,
        });
        if (details.status === 'ok') {
          progress.errorRounds = 0;
        } else {
          progress.errorRounds += 1;
          if (progress.errorRounds >= MAX_DONE_ERROR_ROUNDS) {
            return {
              ...result,
              content: [{ type: 'text', text: formatDoneRepairLimitText(details) }],
              terminate: true,
            };
          }
        }
      }
      return result;
    },
  };
}

function formatDoneRepairLimitText(details: DoneDetails): string {
  const remainingErrors =
    details.errors.length === 0
      ? ['- done() still reported errors, but no actionable verifier details were returned.']
      : details.errors.map(
          (error) => `- ${error.message}${error.lineno ? ` (line ${error.lineno})` : ''}`,
        );
  return [
    'has_errors',
    `Repair limit reached after ${MAX_DONE_ERROR_ROUNDS} done() error rounds.`,
    'STOP. Do not call done, preview, edit, or any other tool again.',
    'The host will keep the workspace files and report verification failure. Do not claim the design is ready.',
    '',
    'Remaining verifier output:',
    ...remainingErrors,
  ].join('\n');
}

function isReasoningContentRoundTripError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  const message = errorMessage.toLowerCase();
  return message.includes('reasoning_content');
}

function finiteUsageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function aggregateAssistantUsage(messages: readonly AgentMessage[]): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
} {
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = (message as PiAssistantMessage).usage;
    totals.inputTokens += finiteUsageNumber(usage?.input);
    totals.outputTokens += finiteUsageNumber(usage?.output);
    totals.costUsd += finiteUsageNumber(usage?.cost?.total);
  }
  return totals;
}

// Retain the actual delivered instruction and completed tools; continuing must not replay either.
export function stripTerminalAssistantFailure(messages: readonly AgentMessage[]): AgentMessage[] {
  const out = [...messages];
  const last = out[out.length - 1];
  if (
    last?.role === 'assistant' &&
    ((last as PiAssistantMessage).stopReason === 'error' ||
      (last as PiAssistantMessage).stopReason === 'aborted')
  ) {
    out.pop();
  }
  return out;
}

function projectContextSections(context: GenerateInput['projectContext']): string[] {
  if (!context) return [];
  const sections: string[] = [];
  if (context.agentsMd?.trim()) {
    sections.push(formatProjectInstructionsContext(context.agentsMd.trim()));
  }
  if (context.designMd?.trim()) {
    const findings = validateDesignMd(context.designMd);
    const errors = findings.filter((finding) => finding.severity === 'error');
    if (errors.length > 0) {
      throw new CodesignError(
        `DESIGN.md is not valid Google design.md: ${errors
          .slice(0, 3)
          .map((finding) => `${finding.path}: ${finding.message}`)
          .join('; ')}`,
        ERROR_CODES.CONFIG_SCHEMA_INVALID,
      );
    }
    sections.push(formatProjectDesignSystemContext(formatDesignMdForPrompt(context.designMd)));
  }
  if (context.invalidDesignMd?.raw.trim()) {
    const errors = context.invalidDesignMd.errors.length
      ? context.invalidDesignMd.errors
      : ['DESIGN.md failed Google design.md validation.'];
    sections.push(
      [
        '# Project Design System Repair Required (DESIGN.md)',
        '',
        'The workspace has a DESIGN.md file, but it is not valid Google design.md yet.',
        'Treat the current file as design-system draft data only. Before calling `done(path)`, repair DESIGN.md with `str_replace_based_edit_tool` so it validates.',
        '',
        'Validation errors:',
        ...errors.map((message) => `- ${message}`),
        '',
        formatUntrustedContext(
          'invalid_design_md',
          'The following workspace DESIGN.md failed validation.',
          context.invalidDesignMd.raw,
        ),
      ].join('\n'),
    );
  }
  if (context.settingsJson?.trim()) {
    sections.push(formatProjectSettingsContext(context.settingsJson.trim()));
  }
  return sections;
}

function workspaceFiles(fs: TextEditorFsCallbacks | undefined): string[] {
  if (!fs) return [];
  return fs
    .listDir('.')
    .filter((file) => file.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function isVirtualTemplatePath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith('frames/') || normalized.startsWith('skills/');
}

function sourceCandidates(
  files: readonly string[],
  fs: TextEditorFsCallbacks | undefined,
): string[] {
  if (!fs) return [];
  const candidates = files.filter((file) => {
    if (isVirtualTemplatePath(file)) return false;
    if (!/\.(?:jsx|tsx|html?)$/i.test(file)) return false;
    const viewed = fs.view(file);
    return viewed !== null && viewed.content.trim().length > 0;
  });
  return candidates
    .sort((a, b) => {
      const score = (file: string): number => {
        const lower = file.toLowerCase();
        if (lower === DEFAULT_SOURCE_ENTRY.toLowerCase()) return 0;
        if (lower === LEGACY_SOURCE_ENTRY.toLowerCase()) return 1;
        if (lower.endsWith('/app.jsx') || lower.endsWith('/app.tsx')) return 2;
        if (lower.endsWith('/index.html')) return 3;
        return 10;
      };
      return score(a) - score(b) || a.localeCompare(b);
    })
    .slice(0, 8);
}

function buildWorkspaceBrief(
  input: GenerateInput,
  fs: TextEditorFsCallbacks | undefined,
): string | null {
  if (!fs) return null;
  const files = workspaceFiles(fs);
  const sources = sourceCandidates(files, fs);
  const hasDesignMd = fs.view('DESIGN.md') !== null;
  const hasAgentsMd = fs.view('AGENTS.md') !== null;
  const hasSettingsJson = fs.view('.codesign/settings.json') !== null;
  const attachmentCount = input.attachments?.length ?? 0;
  const imageCount = (input.attachments ?? []).filter((file) =>
    file.mediaType?.startsWith('image/'),
  ).length;
  const currentDesignName = input.currentDesignName?.trim();
  const needsTitle = isAutoDesignName(currentDesignName);
  const hasReferenceUrl = input.referenceUrl !== null && input.referenceUrl !== undefined;
  const hasReferenceMaterials =
    attachmentCount > 0 ||
    hasReferenceUrl ||
    (input.designSystem !== null && input.designSystem !== undefined);
  const lines = [
    'Workspace context:',
    currentDesignName
      ? `- Current design title: ${currentDesignName}${needsTitle ? ' (auto-generated; call set_title before other tools).' : '.'}`
      : '- Current design title: unknown.',
    sources.length > 0
      ? `- Existing source candidates: ${sources.join(', ')}`
      : `- No existing design source was found. Create ${DEFAULT_SOURCE_ENTRY} for visual/web work, or create the requested document/handoff file for document-first work.`,
    `- DESIGN.md: ${hasDesignMd ? 'present; treat it as the design baton for this workspace.' : 'absent.'}`,
    `- AGENTS.md: ${hasAgentsMd ? 'present' : 'absent'}`,
    `- .codesign/settings.json: ${hasSettingsJson ? 'present' : 'absent'}`,
    `- Reference materials: attached file(s): ${attachmentCount}; image file(s): ${imageCount}; reference URL: ${hasReferenceUrl ? 'yes' : 'no'}; linked design-system scan: ${input.designSystem ? 'yes' : 'no'}.`,
  ];
  lines.push(
    needsTitle
      ? sources.length > 0
        ? 'This workspace has source files, but the visible design title is still an auto-generated placeholder. First call `set_title` once, then inspect/view/edit. Preserve and extend existing source unless the user explicitly asks for a rebuild.'
        : `This is an empty auto-named workspace. First call \`set_title\` once, then create ${DEFAULT_SOURCE_ENTRY} for visual/web work or the requested document file for document-first work. Use set_todos for multi-step work.`
      : sources.length > 0
        ? 'Before editing existing source files, inspect the workspace when available, then view the current source file. Use set_todos when the edit has multiple steps. Existing-source sequence: optional `set_todos` -> `inspect_workspace` when available -> `view` the source -> `str_replace`/`insert`. For continuation or existing-source turns, do not call `set_title`; preserve and extend the current design unless the user explicitly asks for a rebuild.'
        : `This is an empty workspace. For visual/web work, create ${DEFAULT_SOURCE_ENTRY} when the first pass is ready; for document-first work, create the requested document file. Use set_todos for multi-step work.`,
  );
  if (hasDesignMd) {
    lines.push(
      'DESIGN.md is present; read and preserve it as the design baton before changing visual tokens.',
    );
  } else if (sources.length > 0) {
    lines.push(
      'If stable visual decisions emerge across screens, reference-driven work, componentization, or prototype work, create or update a minimal DESIGN.md.',
    );
  }
  if (hasReferenceMaterials) {
    lines.push(
      'Reference materials are available; extract design cues before writing or editing source.',
    );
  }
  return lines.join('\n');
}

function buildTurnPrompt(input: GenerateInput, fs: TextEditorFsCallbacks | undefined): string {
  const prompt = input.prompt.trim();
  if (input.systemPrompt) return prompt;
  const brief = buildWorkspaceBrief(input, fs);
  if (brief === null) return prompt;
  return [brief, '', 'User request:', prompt].join('\n');
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export type { AgentEvent };

export interface GenerateViaAgentDeps {
  activeMessages?: ActiveRunMessages | undefined;
  /** Optional subscriber for Agent lifecycle + streaming events. */
  onEvent?: ((event: AgentEvent) => void) | undefined;
  /** Retry callback — invoked with placeholder reasons today; present so the
   *  IPC layer can reuse the same onRetry signature as the legacy path. */
  onRetry?: ((info: RetryReason) => void) | undefined;
  /** Tools the agent can call. When set, overrides the built-in default toolset.
   * Pass `[]` to explicitly run without tools in focused tests. */
  tools?: AgentTool<TSchema, unknown>[] | undefined;
  /**
   * Virtual filesystem callbacks for str_replace_based_edit_tool. When provided,
   * the default toolset includes `str_replace_based_edit_tool` wired to
   * these callbacks. When undefined, edit/done are hidden from the default
   * toolset.
   */
  fs?: TextEditorFsCallbacks | undefined;
  /**
   * When true, the agent system prompt is augmented with guidance to use
   * set_todos for plans and str_replace_based_edit_tool to write/edit
   * files. Default: true whenever at least one tool is active.
   */
  encourageToolUse?: boolean | undefined;
  /**
   * Optional host-injected runtime verifier for the `done` tool. When set,
   * `done` invokes this callback with the artifact source so the host can
   * mount it in a real runtime (e.g. hidden BrowserWindow) and surface
   * console / load errors back to the agent. Without it, `done` is limited to
   * static lint checks.
   */
  runtimeVerify?: DoneRuntimeVerifier | undefined;
  /**
   * Optional bitmap asset generator. When provided, the default toolset adds
   * `generate_image_asset`; the main design agent decides when a hero/product/
   * poster/background asset is worth generating.
   */
  generateImageAsset?: GenerateImageAssetFn | undefined;
  /**
   * Optional vision-LLM judge for ui_kit visual parity. When provided alongside
   * `renderUiKit`, the default toolset adds `verify_ui_kit_visual_parity`.
   * Without these, the agent has the deterministic verifier only.
   *
   * The judge is host-injected (mirrors `generateImageAsset`) so the core
   * package stays free of provider SDK imports.
   */
  judgeVisualParity?: JudgeVisualParityFn | undefined;
  /**
   * Optional headless renderer that loads ui_kit HTML in a hidden window and
   * returns a screenshot data URL. Paired with `judgeVisualParity` — both must
   * be present for the visual-parity tool to register.
   */
  renderUiKit?: RenderUiKitFn | undefined;
  /** Called when aggressive context pruning triggers (context > 200KB). */
  onAggressivePrune?: (() => void) | undefined;
  /** Called after the agent finishes with the full conversation messages. */
  onComplete?: ((messages: AgentMessage[]) => void) | undefined;
}

/**
 * Route a generate request through pi-agent-core's Agent and the v0.2 design
 * tool surface. Events are emitted so the desktop shell can stream progress,
 * tool calls, and file updates while preserving the GenerateOutput boundary.
 */
export async function generateViaAgent(
  input: GenerateInput,
  deps: GenerateViaAgentDeps = {},
): Promise<GenerateOutput> {
  try {
    return await generateViaAgentInternal(input, deps);
  } finally {
    deps.activeMessages?.close();
  }
}

async function generateViaAgentInternal(
  input: GenerateInput,
  deps: GenerateViaAgentDeps = {},
): Promise<GenerateOutput> {
  const log = input.logger ?? NOOP_LOGGER;
  const ctx = {
    provider: input.model.provider,
    modelId: input.model.modelId,
  } as const;

  if (!input.prompt.trim()) {
    throw new CodesignError('Prompt cannot be empty', ERROR_CODES.INPUT_EMPTY_PROMPT);
  }
  const initialApiKey = input.apiKey.trim();
  if (initialApiKey.length === 0 && input.allowKeyless !== true) {
    throw new CodesignError('Missing API key', ERROR_CODES.PROVIDER_AUTH_MISSING);
  }
  if (!input.systemPrompt && input.mode && input.mode !== 'create') {
    throw new CodesignError(
      'generateViaAgent() built-in prompt only supports mode "create".',
      ERROR_CODES.INPUT_UNSUPPORTED_MODE,
    );
  }

  log.info('[generate] step=resolve_model', ctx);
  const resolveStart = Date.now();
  const piModel = buildPiModel(
    input.model,
    input.wire,
    input.baseUrl,
    input.httpHeaders,
    initialApiKey,
  );
  log.info('[generate] step=resolve_model.ok', { ...ctx, ms: Date.now() - resolveStart });

  log.info('[generate] step=build_request', ctx);
  const buildStart = Date.now();
  const resourceState = cloneResourceState(input.initialResourceState);
  const trackedFs = deps.fs ? trackFsMutations(deps.fs, resourceState, input.signal) : undefined;
  let lastDoneDetails: DoneDetails | undefined;
  const doneProgress = { errorRounds: 0 };
  const repairLimitReached = () => doneProgress.errorRounds >= MAX_DONE_ERROR_ROUNDS;
  const assertNotCancelled = (signal?: AbortSignal): void => {
    if (input.signal?.aborted || signal?.aborted) {
      throw new CodesignError('Generation cancelled', ERROR_CODES.PROVIDER_ABORTED);
    }
  };
  const skillsBuiltinDir = input.templatesRoot
    ? path.join(input.templatesRoot, 'skills')
    : undefined;
  const resourceResult = input.systemPrompt
    ? {
        sections: [] as string[],
        warnings: [] as string[],
        skillCount: 0,
        scaffoldCount: 0,
        brandCount: 0,
      }
    : await collectResourceManifest({
        log,
        providerId: input.model.provider,
        templatesRoot: input.templatesRoot,
      });
  const preflightTitle = isAutoDesignName(input.currentDesignName)
    ? autoTitleFromPrompt(input.prompt)
    : null;
  const promptInput =
    preflightTitle !== null ? { ...input, currentDesignName: preflightTitle } : input;
  const protocolSourceFiles = trackedFs
    ? sourceCandidates(workspaceFiles(trackedFs), trackedFs)
    : [];
  const runProtocol = buildRunProtocolPreflight({
    prompt: input.prompt,
    historyCount: input.history.length,
    workspaceState: { hasSource: protocolSourceFiles.length > 0 },
    runPreferences: input.runPreferences ?? {
      schemaVersion: 1,
      tweaks: 'auto',
      bitmapAssets: 'auto',
      reusableSystem: 'auto',
    },
    attachmentCount: input.attachments?.length ?? 0,
    hasReferenceUrl: input.referenceUrl !== null && input.referenceUrl !== undefined,
    hasDesignSystem:
      (input.designSystem !== null && input.designSystem !== undefined) ||
      Boolean(input.projectContext?.designMd?.trim()),
  });
  const runProtocolState: RunProtocolState = {
    requiresTodosBeforeMutation: runProtocol.requiresTodosBeforeMutation,
    todosSet: false,
  };
  const featureProfile = featureProfileFromRunPreferences(input.runPreferences);
  const systemPrompt =
    input.systemPrompt ??
    composeSystemPrompt({
      mode: 'create',
      userPrompt: input.prompt,
      featureProfile,
    });

  const userContent = buildUserPromptWithContext(
    buildTurnPrompt(promptInput, trackedFs),
    buildContextSections({
      ...(input.designSystem !== undefined ? { designSystem: input.designSystem } : {}),
      ...(input.sessionContext !== undefined ? { sessionContext: input.sessionContext } : {}),
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
      ...(input.memoryContext !== undefined ? { memoryContext: input.memoryContext } : {}),
    }),
  );

  // Assemble the toolset. Caller can pass an explicit list (including []) to
  // override the default. Defaults:
  //   - set_title / set_todos / skill / scaffold (always — no deps)
  //   - str_replace_based_edit_tool + done (when fs callbacks are provided)
  //
  // No generic network-fetch tool is installed here: external fetches must go
  // through the host's permissioned tool path. DESIGN.md context is injected
  // into the prompt instead of fetched through a side tool.
  const scaffoldsRoot = input.templatesRoot ? path.join(input.templatesRoot, 'scaffolds') : null;
  const brandRefsRoot = input.templatesRoot ? path.join(input.templatesRoot, 'brand-refs') : null;
  const getWorkspaceRoot = () => input.getWorkspaceRoot?.() ?? input.workspaceRoot ?? null;
  const defaultToolsByName = new Map<string, AgentTool<TSchema, unknown>>();
  defaultToolsByName.set('set_title', makeSetTitleTool() as unknown as AgentTool<TSchema, unknown>);
  defaultToolsByName.set(
    'set_todos',
    wrapTodosState(makeSetTodosTool() as unknown as AgentTool<TSchema, unknown>, runProtocolState),
  );
  const loadedSkills = new Set<string>();
  defaultToolsByName.set(
    'skill',
    wrapSkillState(
      makeSkillTool({
        dedup: loadedSkills,
        skillsRoot: skillsBuiltinDir ?? null,
        brandRefsRoot,
      }) as unknown as AgentTool<TSchema, unknown>,
      resourceState,
    ),
  );
  defaultToolsByName.set(
    'scaffold',
    wrapPlanningGate(
      wrapScaffoldState(
        makeScaffoldTool(
          getWorkspaceRoot,
          () => scaffoldsRoot,
          input.onScaffolded ? { onScaffolded: input.onScaffolded } : {},
        ) as unknown as AgentTool<TSchema, unknown>,
        resourceState,
      ),
      runProtocolState,
    ),
  );
  if (trackedFs) {
    defaultToolsByName.set(
      'str_replace_based_edit_tool',
      wrapPlanningGate(
        makeTextEditorTool(trackedFs) as unknown as AgentTool<TSchema, unknown>,
        runProtocolState,
        { allowBeforeTodos: isTextEditorView },
      ),
    );
    defaultToolsByName.set(
      'done',
      wrapPlanningGate(
        wrapDoneState(
          makeDoneTool(trackedFs, deps.runtimeVerify, {
            requireDesignMd: true,
          }) as unknown as AgentTool<TSchema, unknown>,
          resourceState,
          (details) => {
            lastDoneDetails = details;
          },
          doneProgress,
        ),
        runProtocolState,
      ),
    );
    defaultToolsByName.set(
      'decompose_to_ui_kit',
      wrapPlanningGate(
        makeDecomposeToUiKitTool(trackedFs, log) as unknown as AgentTool<TSchema, unknown>,
        runProtocolState,
      ),
    );
    defaultToolsByName.set(
      'verify_ui_kit_parity',
      wrapPlanningGate(
        makeVerifyUiKitParityTool(trackedFs, log) as unknown as AgentTool<TSchema, unknown>,
        runProtocolState,
      ),
    );
    if (deps.renderUiKit && deps.judgeVisualParity) {
      defaultToolsByName.set(
        'verify_ui_kit_visual_parity',
        wrapPlanningGate(
          makeVerifyUiKitVisualParityTool(
            trackedFs,
            deps.renderUiKit,
            deps.judgeVisualParity,
            log,
          ) as unknown as AgentTool<TSchema, unknown>,
          runProtocolState,
        ),
      );
    }
  }
  if (input.runPreview) {
    const vision = piModel.input?.includes('image') === true;
    defaultToolsByName.set(
      'preview',
      wrapPlanningGate(
        makePreviewTool(input.runPreview, { vision }) as unknown as AgentTool<TSchema, unknown>,
        runProtocolState,
      ),
    );
  }
  const imageExplicitlyDisabled = explicitDisabled(featureProfile.bitmapAssets);
  const tweaksExplicitlyDisabled = explicitDisabled(featureProfile.tweaks);
  if (deps.generateImageAsset && !imageExplicitlyDisabled) {
    defaultToolsByName.set(
      'generate_image_asset',
      wrapPlanningGate(
        makeGenerateImageAssetTool(deps.generateImageAsset, trackedFs, log) as unknown as AgentTool<
          TSchema,
          unknown
        >,
        runProtocolState,
      ),
    );
  }
  if (input.inspectWorkspace) {
    defaultToolsByName.set(
      'inspect_workspace',
      makeInspectWorkspaceTool(input.inspectWorkspace) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  if (input.readWorkspaceFiles && !tweaksExplicitlyDisabled) {
    defaultToolsByName.set(
      'tweaks',
      wrapPlanningGate(
        makeTweaksTool(input.readWorkspaceFiles) as unknown as AgentTool<TSchema, unknown>,
        runProtocolState,
      ),
    );
  }
  if (input.askBridge) {
    defaultToolsByName.set(
      'ask',
      makeAskTool(input.askBridge) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  const defaultTools = availableToolNames({
    fs: trackedFs !== undefined,
    preview: input.runPreview !== undefined,
    image: deps.generateImageAsset !== undefined && !imageExplicitlyDisabled,
    workspaceInspector: input.inspectWorkspace !== undefined,
    workspaceReader: input.readWorkspaceFiles !== undefined && !tweaksExplicitlyDisabled,
    ask: input.askBridge !== undefined,
  })
    .map((name) => defaultToolsByName.get(name))
    .filter((tool): tool is AgentTool<TSchema, unknown> => tool !== undefined);
  const tools = (deps.tools ?? defaultTools).map((tool) => ({
    ...tool,
    async execute(...args: Parameters<typeof tool.execute>) {
      assertNotCancelled(args[2]);
      return tool.execute(...args);
    },
  }));
  const encourageToolUse = deps.encourageToolUse ?? tools.length > 0;
  const baseAgenticGuidance = agenticToolGuidance({
    inspectWorkspace: input.inspectWorkspace !== undefined,
    featureProfile,
    currentDesignName: promptInput.currentDesignName,
  });
  const activeGuidance =
    deps.generateImageAsset && !imageExplicitlyDisabled
      ? `${baseAgenticGuidance}\n\n${IMAGE_ASSET_TOOL_GUIDANCE}`
      : baseAgenticGuidance;
  const promptImages = attachmentImagesForModel(input, piModel);
  const augmentedSystemPrompt = [
    encourageToolUse ? `${systemPrompt}\n\n${activeGuidance}` : systemPrompt,
    ...resourceResult.sections,
    ...projectContextSections(input.projectContext),
  ].join('\n\n');

  // Seed the transcript with prior history (already in ChatMessage shape).
  const historyAsAgentMessages: AgentMessage[] = input.history.map((m, idx) =>
    chatMessageToAgentMessage(m, idx + 1, piModel),
  );
  log.info('[generate] step=build_request.ok', {
    ...ctx,
    ms: Date.now() - buildStart,
    messages: historyAsAgentMessages.length + 2,
    systemChars: augmentedSystemPrompt.length,
    userChars: userContent.length,
    promptImages: promptImages.length,
    historyCount: input.history.length,
    toolNames: tools.map((tool) => tool.name),
    skills: resourceResult.skillCount,
    scaffolds: resourceResult.scaffoldCount,
    brandRefs: resourceResult.brandCount,
    projectContext: {
      agentsMd: Boolean(input.projectContext?.agentsMd?.trim()),
      designMd: Boolean(input.projectContext?.designMd?.trim()),
      settingsJson: Boolean(input.projectContext?.settingsJson?.trim()),
    },
    memoryContextCount: input.memoryContext?.length ?? 0,
    sessionContextCount: input.sessionContext?.length ?? 0,
    resourceWarnings: resourceResult.warnings.length,
    resourceState: {
      mutationSeq: resourceState.mutationSeq,
      loadedSkills: resourceState.loadedSkills.length,
      loadedBrandRefs: resourceState.loadedBrandRefs.length,
      scaffoldedFiles: resourceState.scaffoldedFiles.length,
    },
  });

  // Resolve reasoning/thinking level: explicit per-call override (sourced
  // from ProviderEntry.reasoningLevel by the desktop main process) takes
  // precedence, then the model-family default from reasoningForModel. If
  // neither yields a value the agent runs with 'off', matching
  // pi-agent-core's default.
  const thinkingLevel =
    input.reasoningLevel ?? reasoningForModel(input.model, input.baseUrl) ?? 'off';

  // Build the Agent. convertToLlm narrows AgentMessage (may include custom
  // types) to the LLM-visible Message subset.
  //
  // `capturedGetApiKeyError` preserves structured errors thrown by the
  // per-turn async getter (e.g. `CodesignError(PROVIDER_AUTH_MISSING)` when
  // the user signs out mid-run). pi-agent-core flattens thrown errors into a
  // plain `errorMessage: string` on the failure AgentMessage, which would
  // otherwise cause us to re-wrap as `PROVIDER_ERROR` below. Stashing the
  // original lets the post-agent branch rethrow it as-is, so the renderer
  // sees the same code the initial IPC-level resolution would emit.
  let capturedGetApiKeyError: unknown = null;

  // Factory for creating agents with a given message history. Used for both
  // the initial agent and retry agents that continue the interrupted transcript.
  const createRetryAgent = (
    messages: AgentMessage[],
    retryThinkingLevel = thinkingLevel,
  ): Agent => {
    const onPayload =
      piModel.api === 'openai-responses' ? sanitizeOpenAIResponsesPayloadForStoreFalse : undefined;
    const retryAgent = new Agent({
      initialState: {
        systemPrompt: augmentedSystemPrompt,
        model: piModel as unknown as PiAiModel<'openai-completions'>,
        messages,
        tools,
        thinkingLevel: retryThinkingLevel,
      },
      convertToLlm: (msgs) =>
        msgs.filter(
          (m): m is PiAiMessage =>
            m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
        ),
      transformContext: buildTransformContext(log, deps.onAggressivePrune),
      beforeToolCall: async (_context, signal) => {
        if (input.signal?.aborted || signal?.aborted) {
          return { block: true, reason: 'Generation cancelled' };
        }
        if (repairLimitReached()) {
          return { block: true, reason: 'Done repair limit reached; no further tools may run.' };
        }
        return undefined;
      },
      getApiKey: input.getApiKey
        ? async () => {
            try {
              assertNotCancelled();
              const key = await input.getApiKey?.();
              assertNotCancelled();
              const trimmedKey = key?.trim() ?? '';
              if (trimmedKey.length > 0) return trimmedKey;
              if (input.allowKeyless === true) return initialApiKey || 'open-codesign-keyless';
              throw new CodesignError(
                `No API key returned for provider "${input.model.provider}".`,
                ERROR_CODES.PROVIDER_AUTH_MISSING,
              );
            } catch (err) {
              capturedGetApiKeyError = err;
              throw err;
            }
          }
        : () => {
            assertNotCancelled();
            return initialApiKey || 'open-codesign-keyless';
          },
      ...(onPayload !== undefined ? { onPayload } : {}),
    });
    retryAgent.subscribe((event) => {
      deps.activeMessages?.handleEvent(event, () => {
        resourceState.lastDone = null;
        runProtocolState.todosSet = false;
        lastDoneDetails = undefined;
        doneProgress.errorRounds = 0;
      });
      deps.onEvent?.(event);
      if (event.type === 'turn_end') {
        assertNotCancelled();
        // Agent does not expose the low-level shouldStopAfterTurn hook. Fail the
        // settled batch at its native event boundary, before pi drains queues.
        if (repairLimitReached()) {
          throw new CodesignError('Done repair limit reached', ERROR_CODES.GENERATION_INCOMPLETE);
        }
      }
    });
    deps.activeMessages?.bind(retryAgent);
    return retryAgent;
  };

  let agent = createRetryAgent(historyAsAgentMessages);
  const admitRun = async (run: () => Promise<void>): Promise<void> => {
    assertNotCancelled();
    const target = agent;
    const abort = () => target.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      assertNotCancelled();
      await run();
      await target.waitForIdle();
      assertNotCancelled();
    } finally {
      input.signal?.removeEventListener('abort', abort);
    }
  };

  log.info('[generate] step=send_request', ctx);
  const sendStart = Date.now();
  assertNotCancelled();
  if (preflightTitle !== null) {
    emitPreflightSetTitle(deps.onEvent, preflightTitle);
  }
  // First-turn-only retry, further guarded by a side-effect check. Multi-turn
  // requests carry half-complete agent state (tool calls mid-flight, transcript
  // accumulated in pi-agent-core's internal loop) — retrying would replay
  // partial progress and corrupt the session. Even on the first turn, retrying
  // is safe only before any assistant message has landed in `agent.state`:
  // once the model has emitted tokens or tool calls, side effects
  // (str_replace_based_edit_tool writes, set_todos state) have already fired
  // and a retry would re-run them.
  // The pre-attempt snapshot of `agent.state.messages.length` lets us detect
  // whether the failed attempt produced any such artefact and, if so, mark the
  // error as non-retryable.
  const isFirstTurn = input.history.length === 0;
  const RETRY_BLOCKED = Symbol.for('open-codesign.retry.blocked');
  type RetryBlockedError = Error & { [RETRY_BLOCKED]?: true };
  const sendOnce = async (): Promise<void> => {
    const preLen = agent.state.messages.length;
    try {
      await admitRun(() => agent.prompt(userContent, promptImages));
    } catch (err) {
      if (agent.state.messages.length > preLen) {
        const tagged = (err instanceof Error ? err : new Error(String(err))) as RetryBlockedError;
        tagged[RETRY_BLOCKED] = true;
        throw tagged;
      }
      throw err;
    }
  };
  try {
    if (isFirstTurn) {
      const retryOpts: Parameters<typeof withBackoff>[1] = {
        maxRetries: 3,
        classify: (err): RetryDecision => {
          if ((err as RetryBlockedError)[RETRY_BLOCKED]) {
            return { retry: false, reason: 'agent already produced side effects' };
          }
          return classifyError(err);
        },
        onRetry: (info: RetryReason) => {
          log.warn('[generate] step=send_request.retry', {
            ...ctx,
            attempt: info.attempt,
            totalAttempts: info.totalAttempts,
            delayMs: info.delayMs,
            reason: info.reason,
          });
          deps.onRetry?.(info);
        },
      };
      if (input.signal) retryOpts.signal = input.signal;
      await withBackoff(sendOnce, retryOpts);
    } else {
      await sendOnce();
    }
  } catch (err) {
    log.error('[generate] step=send_request.fail', {
      ...ctx,
      ms: Date.now() - sendStart,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    throw remapProviderError(err, input.model.provider, input.wire);
  }

  // Post-agent recovery:
  // - Retry transport-level failures from the interrupted user/tool-result boundary.
  // - Retry reasoning_content round-trip failures once with thinking off,
  //   preserving the current transcript up to the failed provider response.
  let transportRetryCount = 0;
  let reasoningFallbackUsed = false;
  while (true) {
    const checkMsg = findFinalAssistantMessage(agent.state.messages);
    if (!checkMsg || checkMsg.stopReason === 'stop') break;
    if (input.signal?.aborted || repairLimitReached()) break;

    const shouldRetryWithoutReasoning =
      !reasoningFallbackUsed &&
      thinkingLevel !== 'off' &&
      checkMsg.stopReason === 'error' &&
      isReasoningContentRoundTripError(checkMsg.errorMessage);
    if (shouldRetryWithoutReasoning) {
      reasoningFallbackUsed = true;
      log.warn('[generate] step=reasoning_retry', {
        ...ctx,
        reason: checkMsg.errorMessage,
      });
      deps.onRetry?.({
        attempt: 1,
        totalAttempts: 1,
        delayMs: 0,
        reason: `reasoning retry: ${checkMsg.errorMessage}`,
      });

      const cleanMessages = stripTerminalAssistantFailure(agent.state.messages);
      capturedGetApiKeyError = null;
      agent = createRetryAgent(cleanMessages, 'off');

      const retryStart = Date.now();
      try {
        await admitRun(() => agent.continue());
      } catch (err) {
        log.error('[generate] step=reasoning_retry.fail', {
          ...ctx,
          ms: Date.now() - retryStart,
          errorClass: err instanceof Error ? err.constructor.name : typeof err,
        });
        throw remapProviderError(err, input.model.provider, input.wire);
      }
      continue;
    }

    if (transportRetryCount >= MAX_TRANSPORT_RETRIES) break;
    const retryableTransportFailure =
      checkMsg.stopReason === 'error'
        ? isTransportLevelError(checkMsg.errorMessage)
        : checkMsg.stopReason === 'aborted' &&
          isProviderAbortedTransportError(
            checkMsg.errorMessage ?? messageForIncompleteStop(checkMsg.stopReason),
          );
    if (!retryableTransportFailure) break;

    transportRetryCount++;
    log.warn('[generate] step=transport_retry', {
      ...ctx,
      attempt: transportRetryCount,
      maxAttempts: MAX_TRANSPORT_RETRIES,
      reason: checkMsg.errorMessage,
    });
    deps.onRetry?.({
      attempt: transportRetryCount,
      totalAttempts: MAX_TRANSPORT_RETRIES,
      delayMs: 0,
      reason: `transport retry: ${checkMsg.errorMessage}`,
    });

    const cleanMessages = stripTerminalAssistantFailure(agent.state.messages);
    capturedGetApiKeyError = null;
    agent = createRetryAgent(cleanMessages, reasoningFallbackUsed ? 'off' : thinkingLevel);

    const retryStart = Date.now();
    try {
      await admitRun(() => agent.continue());
    } catch (err) {
      log.error('[generate] step=transport_retry.fail', {
        ...ctx,
        attempt: transportRetryCount,
        ms: Date.now() - retryStart,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
      });
      throw remapProviderError(err, input.model.provider, input.wire);
    }
  }

  const finalAssistant = findFinalAssistantMessage(agent.state.messages);
  if (!finalAssistant) {
    throw new CodesignError('Agent produced no assistant message', ERROR_CODES.PROVIDER_ERROR);
  }
  const stoppedAfterDoneRepairLimit = repairLimitReached();
  if (finalAssistant.stopReason !== 'stop' && !stoppedAfterDoneRepairLimit) {
    // Prefer the original `getApiKey` throw (e.g. PROVIDER_AUTH_MISSING after
    // mid-run logout) over pi-agent-core's flattened plain-string failure,
    // so the renderer's error-code routing stays consistent with the path
    // that would have fired if the same error had been raised at IPC entry.
    if (
      capturedGetApiKeyError !== null &&
      (finalAssistant.stopReason === 'error' || finalAssistant.stopReason === 'aborted')
    ) {
      log.error('[generate] step=send_request.fail', {
        ...ctx,
        ms: Date.now() - sendStart,
        stopReason: finalAssistant.stopReason,
        reason: 'getApiKey_threw',
      });
      throw capturedGetApiKeyError;
    }
    const message =
      finalAssistant.errorMessage ?? messageForIncompleteStop(finalAssistant.stopReason);
    const code =
      finalAssistant.stopReason === 'aborted'
        ? ERROR_CODES.PROVIDER_ABORTED
        : ERROR_CODES.PROVIDER_ERROR;
    log.error('[generate] step=send_request.fail', {
      ...ctx,
      ms: Date.now() - sendStart,
      stopReason: finalAssistant.stopReason,
    });
    throw remapProviderError(new CodesignError(message, code), input.model.provider, input.wire);
  }
  log.info('[generate] step=send_request.ok', { ...ctx, ms: Date.now() - sendStart });

  deps.onComplete?.(agent.state.messages);

  if (lastDoneDetails?.status === 'has_errors') {
    const remaining = lastDoneDetails.errors
      .slice(0, 8)
      .map((error) => `${error.message}${error.lineno ? ` (line ${error.lineno})` : ''}`)
      .join('\n');
    const message = [
      `Design verification failed for ${lastDoneDetails.path}.`,
      ...(repairLimitReached()
        ? [`The repair limit was reached after ${MAX_DONE_ERROR_ROUNDS} done() error rounds.`]
        : []),
      'The workspace files have been kept, but the design is not ready. Fix the errors and retry.',
      remaining,
    ]
      .filter(Boolean)
      .join('\n');
    log.error('[generate] step=verify.fail', {
      ...ctx,
      path: lastDoneDetails.path,
      errorCount: lastDoneDetails.errors.length,
      repairLimitReached: repairLimitReached(),
    });
    throw new CodesignError(message, ERROR_CODES.GENERATION_INCOMPLETE);
  }

  log.info('[generate] step=parse_response', ctx);
  const parseStart = Date.now();
  const fullText = finalAssistant.content
    .filter(
      (c): c is { type: 'text'; text: string } =>
        c.type === 'text' && typeof (c as { text?: unknown }).text === 'string',
    )
    .map((c) => c.text)
    .join('');

  const collected: Collected = { text: fullText, artifacts: [] };

  // The agent writes design source through str_replace_based_edit_tool — final
  // assistant text is prose, not an `<artifact>` blob. Pull the primary source
  // out of the virtual FS to populate the artifact list while preserving source
  // metadata separately from the export/render artifact type.
  if (deps.fs) {
    const primary = deps.fs.view(DEFAULT_SOURCE_ENTRY);
    const legacy = primary === null ? deps.fs.view(LEGACY_SOURCE_ENTRY) : null;
    const entryPath = primary !== null ? DEFAULT_SOURCE_ENTRY : LEGACY_SOURCE_ENTRY;
    const file = primary ?? legacy;
    if (file !== null && file.content.trim().length > 0) {
      collected.artifacts.push(createDesignSourceArtifact(file.content, 0, entryPath));
    }
  }
  const finalizationWarnings =
    deps.tools === undefined && deps.fs !== undefined
      ? assertFinalizationGate({
          state: resourceState,
          fs: deps.fs,
          enforce: resourceState.mutationSeq > 0,
          allowUnresolvedDoneWithArtifact: collected.artifacts.length > 0,
        })
      : [];
  log.info('[generate] step=parse_response.ok', {
    ...ctx,
    ms: Date.now() - parseStart,
    artifacts: collected.artifacts.length,
    mutationSeq: resourceState.mutationSeq,
    doneStatus: resourceState.lastDone?.status ?? 'none',
  });

  const usage = aggregateAssistantUsage(agent.state.messages);
  const output: GenerateOutput = {
    message: stripEmptyFences(collected.text),
    artifacts: collected.artifacts,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    resourceState,
  };
  const warnings = [...finalizationWarnings, ...resourceResult.warnings];
  return warnings.length > 0
    ? { ...output, warnings: [...(output.warnings ?? []), ...warnings] }
    : output;
}

function messageForIncompleteStop(stopReason: 'length' | 'toolUse' | 'error' | 'aborted'): string {
  if (stopReason === 'length') {
    return 'Agent response stopped before completion because the provider hit the token limit';
  }
  if (stopReason === 'toolUse') {
    return 'Agent stopped with an unresolved tool call';
  }
  if (stopReason === 'aborted') return 'Generation aborted by provider';
  return 'Provider returned an error';
}

function chatMessageToAgentMessage(
  m: ChatMessage,
  timestamp: number,
  piModel: PiModel,
): AgentMessage {
  if (m.role === 'user') {
    return { role: 'user', content: m.content, timestamp };
  }
  if (m.role === 'assistant') {
    // pi-ai types `api` and `provider` as string unions internal to the SDK.
    // Cast through `unknown` so we don't widen the call-site with `any` while
    // still returning an AgentMessage pi-agent-core accepts verbatim.
    const assistant = {
      role: 'assistant',
      api: piModel.api,
      provider: piModel.provider,
      model: piModel.id,
      content: m.content.length === 0 ? [] : [{ type: 'text', text: m.content }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop' as const,
      timestamp,
    };
    return assistant as unknown as AgentMessage;
  }
  // System messages are handled via initialState.systemPrompt — filter upstream.
  return { role: 'user', content: m.content, timestamp };
}

function findFinalAssistantMessage(messages: AgentMessage[]): PiAssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === 'assistant') {
      return msg as PiAssistantMessage;
    }
  }
  return undefined;
}
