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
import type { Message as PiAiMessage, Model as PiAiModel } from '@mariozechner/pi-ai';
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
  ERROR_CODES,
  formatDesignMdForPrompt,
  LEGACY_SOURCE_ENTRY,
  type ModelRef,
  type ResourceStateV1,
  validateDesignMd,
  type WireApi,
} from '@open-codesign/shared';
import type { TSchema } from '@sinclair/typebox';
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
import { availableToolNames } from './tool-manifest.js';
import { makeAskTool } from './tools/ask.js';
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
  };
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
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
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
  };
  if (!supportsOpenAIDeveloperRole(wire, canonicalBase)) {
    out.compat = { supportsDeveloperRole: false };
  }
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

function agenticToolGuidance(input: { inspectWorkspace: boolean }): string {
  const requiredSteps = [
    '1. Call `set_title`; call `set_todos` for multi-step work.',
    '2. Load optional resources explicitly with `skill(name)` or `scaffold({kind, destPath})` before relying on them.',
    ...(input.inspectWorkspace
      ? [
          '3. When the workspace brief says files or reference materials are present, call `inspect_workspace` before editing, then `view` the specific files you need.',
        ]
      : []),
    `${input.inspectWorkspace ? '4' : '3'}. Write/edit the design source at \`${DEFAULT_SOURCE_ENTRY}\`, then call \`preview(path)\` when available.`,
    `${input.inspectWorkspace ? '5' : '4'}. Call \`tweaks()\` for meaningful EDITMODE controls.`,
    `${input.inspectWorkspace ? '6' : '5'}. Call \`done(path)\` after the final mutation. If it reports errors, fix and retry, but stop after ${MAX_DONE_ERROR_ROUNDS} error rounds.`,
  ];
  return [
    '## Workspace output contract',
    '',
    `- Write the main design source to \`${DEFAULT_SOURCE_ENTRY}\` with \`str_replace_based_edit_tool\`; chat text is never the artifact.`,
    '- Use `create` for new files; follow-up edits use `view`, `str_replace`, or `insert`.',
    '- Do not emit `<artifact>` tags, fenced source blocks, raw HTML/JSX/CSS, or HTML wrappers in chat.',
    '- Local workspace assets and scaffolded files are allowed. External scripts remain restricted by the base output rules.',
    '',
    '## Required tool loop',
    '',
    ...requiredSteps,
    '',
    '## File-edit discipline',
    '',
    '- Keep `old_str` small and unique. Large replacements waste context and are fragile.',
    '- Never view just to check whether an edit succeeded; the tool reports failures.',
  ].join('\n');
}

const IMAGE_ASSET_TOOL_GUIDANCE = [
  '## Bitmap asset generation',
  '',
  'Use `generate_image_asset` only for named or clearly beneficial bitmap slots: hero, product, poster, background, illustration, or rendered logo.',
  'Before writing the design source, inventory required assets and request all bitmap assets in one batch. One named bitmap slot equals one tool call.',
  'Use inline SVG/CSS for charts, simple icons, flat geometric marks, gradients, and UI chrome.',
  'Each call needs a production prompt, accurate `purpose`, matching `aspectRatio`, meaningful `alt`, and optional `filenameHint`.',
  'Reference the returned local `assets/...` path from the design source.',
].join('\n');

// ---------------------------------------------------------------------------
// Transport-level retry helpers.
// ---------------------------------------------------------------------------

const MAX_TRANSPORT_RETRIES = 2;

/**
 * Remove the failed final turn from the agent message history so a fresh agent
 * can retry with a clean slate. Walks backwards from the terminal error
 * assistant message to find the user message that started the turn, removing
 * all intermediate tool-call / toolResult entries in between.
 */
export function stripFailedTurn(messages: readonly AgentMessage[]): AgentMessage[] {
  let errorIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (errorIndex === -1) {
      if (msg.role === 'assistant' && (msg as PiAssistantMessage).stopReason === 'error') {
        errorIndex = i;
      }
      continue;
    }
    if (msg.role === 'user') {
      return [...messages.slice(0, i), ...messages.slice(errorIndex + 1)];
    }
  }
  return errorIndex === -1 ? [...messages] : messages.slice(0, errorIndex);
}

function trackFsMutations(
  fs: TextEditorFsCallbacks,
  resourceState: ResourceStateV1,
): TextEditorFsCallbacks {
  return {
    view: (path) => fs.view(path),
    listDir: (dir) => fs.listDir(dir),
    async create(path, content) {
      const result = await fs.create(path, content);
      recordMutation(resourceState);
      return result;
    },
    async strReplace(path, oldStr, newStr) {
      const result = await fs.strReplace(path, oldStr, newStr);
      recordMutation(resourceState);
      return result;
    },
    async insert(path, line, text) {
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
    async execute(id, params, signal): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(id, params, signal);
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
    async execute(id, params, signal): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(id, params, signal);
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
  onRepairLimitReached?: (() => void) | undefined,
): AgentTool<TSchema, unknown> {
  let errorRounds = 0;
  return {
    ...tool,
    executionMode: 'sequential',
    async execute(id, params, signal): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(id, params, signal);
      const details = result.details as DoneDetails | undefined;
      if (details) {
        recordDone(resourceState, {
          status: details.status,
          path: details.path,
          errorCount: details.errors.length,
        });
        if (details.status === 'ok') {
          errorRounds = 0;
        } else {
          errorRounds += 1;
          if (errorRounds >= MAX_DONE_ERROR_ROUNDS) {
            onRepairLimitReached?.();
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

function wrapSetTodosState(
  tool: AgentTool<TSchema, unknown>,
  onSetTodos: () => void,
): AgentTool<TSchema, unknown> {
  return {
    ...tool,
    async execute(id, params, signal): Promise<AgentToolResult<unknown>> {
      const result = await tool.execute(id, params, signal);
      onSetTodos();
      return result;
    },
  };
}

function wrapEditRequiresTodos(
  tool: AgentTool<TSchema, unknown>,
  hasTodos: () => boolean,
): AgentTool<TSchema, unknown> {
  return {
    ...tool,
    async execute(id, params, signal): Promise<AgentToolResult<unknown>> {
      const command =
        typeof params === 'object' && params !== null
          ? (params as Record<string, unknown>)['command']
          : undefined;
      if (
        (command === 'create' || command === 'str_replace' || command === 'insert') &&
        !hasTodos()
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Call set_todos with a short checklist before making substantive file edits, then retry this edit.',
            },
          ],
          details: {
            status: 'blocked',
            reason: 'set_todos_required',
          },
        };
      }
      return tool.execute(id, params, signal);
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
    'The host will keep the latest artifact when possible and surface these warnings to the user.',
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

function stripTerminalAssistantFailure(messages: readonly AgentMessage[]): AgentMessage[] {
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

function prepareReasoningFallback(messages: readonly AgentMessage[]): {
  messages: AgentMessage[];
  mode: 'continue' | 'prompt';
} {
  const cleanMessages = stripTerminalAssistantFailure(messages);
  const last = cleanMessages[cleanMessages.length - 1];
  if (last?.role === 'toolResult') {
    return { messages: cleanMessages, mode: 'continue' };
  }
  if (last?.role === 'user') {
    return { messages: cleanMessages.slice(0, -1), mode: 'prompt' };
  }
  return { messages: cleanMessages, mode: 'prompt' };
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

function sourceCandidates(
  files: readonly string[],
  fs: TextEditorFsCallbacks | undefined,
): string[] {
  if (!fs) return [];
  const candidates = files.filter((file) => {
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
  const hasReferenceUrl = input.referenceUrl !== null && input.referenceUrl !== undefined;
  const hasReferenceMaterials =
    attachmentCount > 0 ||
    hasReferenceUrl ||
    (input.designSystem !== null && input.designSystem !== undefined);
  const lines = [
    'Workspace context:',
    sources.length > 0
      ? `- Existing source candidates: ${sources.join(', ')}`
      : `- No existing design source was found. Create ${DEFAULT_SOURCE_ENTRY} as the main design source.`,
    `- DESIGN.md: ${hasDesignMd ? 'present; treat it as the design baton for this workspace.' : 'absent.'}`,
    `- AGENTS.md: ${hasAgentsMd ? 'present' : 'absent'}`,
    `- .codesign/settings.json: ${hasSettingsJson ? 'present' : 'absent'}`,
    `- Reference materials: attached file(s): ${attachmentCount}; image file(s): ${imageCount}; reference URL: ${hasReferenceUrl ? 'yes' : 'no'}; linked design-system scan: ${input.designSystem ? 'yes' : 'no'}.`,
  ];
  lines.push(
    sources.length > 0
      ? 'Inspect the workspace before editing existing source files. Preserve and extend the current design unless the user explicitly asks for a rebuild.'
      : 'Start from the user request and any references, then create the workspace source.',
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
  const trackedFs = deps.fs ? trackFsMutations(deps.fs, resourceState) : undefined;
  let doneRepairLimitReached = false;
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
  const systemPrompt =
    input.systemPrompt ??
    composeSystemPrompt({
      mode: 'create',
      userPrompt: input.prompt,
    });

  const userContent = buildUserPromptWithContext(
    buildTurnPrompt(input, trackedFs),
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
  let todosCalledThisRun = false;
  defaultToolsByName.set(
    'set_todos',
    wrapSetTodosState(makeSetTodosTool() as unknown as AgentTool<TSchema, unknown>, () => {
      todosCalledThisRun = true;
    }),
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
    wrapScaffoldState(
      makeScaffoldTool(getWorkspaceRoot, () => scaffoldsRoot) as unknown as AgentTool<
        TSchema,
        unknown
      >,
      resourceState,
    ),
  );
  if (trackedFs) {
    defaultToolsByName.set(
      'str_replace_based_edit_tool',
      wrapEditRequiresTodos(
        makeTextEditorTool(trackedFs) as unknown as AgentTool<TSchema, unknown>,
        () => todosCalledThisRun,
      ),
    );
    defaultToolsByName.set(
      'done',
      wrapDoneState(
        makeDoneTool(trackedFs, deps.runtimeVerify, {
          requireDesignMd: true,
        }) as unknown as AgentTool<TSchema, unknown>,
        resourceState,
        () => {
          doneRepairLimitReached = true;
        },
      ),
    );
  }
  if (input.runPreview) {
    const vision = piModel.input?.includes('image') === true;
    defaultToolsByName.set(
      'preview',
      makePreviewTool(input.runPreview, { vision }) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  if (deps.generateImageAsset) {
    defaultToolsByName.set(
      'generate_image_asset',
      makeGenerateImageAssetTool(deps.generateImageAsset, trackedFs, log) as unknown as AgentTool<
        TSchema,
        unknown
      >,
    );
  }
  if (input.inspectWorkspace) {
    defaultToolsByName.set(
      'inspect_workspace',
      makeInspectWorkspaceTool(input.inspectWorkspace) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  if (input.readWorkspaceFiles) {
    defaultToolsByName.set(
      'tweaks',
      makeTweaksTool(input.readWorkspaceFiles) as unknown as AgentTool<TSchema, unknown>,
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
    image: deps.generateImageAsset !== undefined,
    workspaceInspector: input.inspectWorkspace !== undefined,
    workspaceReader: input.readWorkspaceFiles !== undefined,
    ask: input.askBridge !== undefined,
  })
    .map((name) => defaultToolsByName.get(name))
    .filter((tool): tool is AgentTool<TSchema, unknown> => tool !== undefined);
  const tools = deps.tools ?? defaultTools;
  const encourageToolUse = deps.encourageToolUse ?? tools.length > 0;
  const baseAgenticGuidance = agenticToolGuidance({
    inspectWorkspace: input.inspectWorkspace !== undefined,
  });
  const activeGuidance = deps.generateImageAsset
    ? `${baseAgenticGuidance}\n\n${IMAGE_ASSET_TOOL_GUIDANCE}`
    : baseAgenticGuidance;
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
  // the initial agent and transport-level retry agents (conversation replay).
  const createRetryAgent = (
    messages: AgentMessage[],
    retryThinkingLevel = thinkingLevel,
  ): Agent => {
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
      getApiKey: input.getApiKey
        ? async () => {
            try {
              const key = await input.getApiKey?.();
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
        : () => initialApiKey || 'open-codesign-keyless',
    });
    if (deps.onEvent) {
      retryAgent.subscribe((event) => deps.onEvent?.(event));
    }
    return retryAgent;
  };

  const attachAbortSignal = (target: Agent): void => {
    if (!input.signal) return;
    if (input.signal.aborted) {
      target.abort();
    } else {
      input.signal.addEventListener('abort', () => target.abort(), { once: true });
    }
  };

  let agent = createRetryAgent(historyAsAgentMessages);

  attachAbortSignal(agent);

  log.info('[generate] step=send_request', ctx);
  const sendStart = Date.now();
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
      await agent.prompt(userContent);
      await agent.waitForIdle();
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
  // - Retry transport-level failures by replaying the turn from clean history.
  // - Retry reasoning_content round-trip failures once with thinking off,
  //   preserving the current transcript up to the failed provider response.
  let transportRetryCount = 0;
  let reasoningFallbackUsed = false;
  while (true) {
    const checkMsg = findFinalAssistantMessage(agent.state.messages);
    if (!checkMsg || checkMsg.stopReason === 'stop') break;
    if (input.signal?.aborted) break;

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

      const fallback = prepareReasoningFallback(agent.state.messages);
      capturedGetApiKeyError = null;
      agent = createRetryAgent(fallback.messages, 'off');
      attachAbortSignal(agent);

      const retryStart = Date.now();
      try {
        if (fallback.mode === 'continue') {
          await agent.continue();
        } else {
          await agent.prompt(userContent);
        }
        await agent.waitForIdle();
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

    const cleanMessages = stripFailedTurn(agent.state.messages);
    capturedGetApiKeyError = null;
    agent = createRetryAgent(cleanMessages);
    attachAbortSignal(agent);

    const retryStart = Date.now();
    try {
      await agent.prompt(userContent);
      await agent.waitForIdle();
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
  const stoppedAfterDoneRepairLimit =
    doneRepairLimitReached && finalAssistant.stopReason === 'toolUse';
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

  log.info('[generate] step=parse_response', ctx);
  const parseStart = Date.now();
  const fullText = stoppedAfterDoneRepairLimit
    ? `Stopped after ${MAX_DONE_ERROR_ROUNDS} done() error rounds. The latest artifact is available with warnings.`
    : finalAssistant.content
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

  const usage = finalAssistant.usage;
  const output: GenerateOutput = {
    message: stripEmptyFences(collected.text),
    artifacts: collected.artifacts,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    costUsd: usage?.cost?.total ?? 0,
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
