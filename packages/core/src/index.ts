import type { ReasoningLevel } from '@open-codesign/providers';
import { completeWithRetry, type RetryReason } from '@open-codesign/providers';
import type {
  Artifact,
  ChatMessage,
  ModelRef,
  SelectedElement,
  StoredDesignSystem,
  WireApi,
} from '@open-codesign/shared';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { type GenerateViaAgentDeps, generateViaAgent as runAgent } from './agent.js';
import { remapProviderError } from './errors.js';
import { buildContextSections } from './lib/context-format.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';
import { composeSystemPrompt, type PromptComposeOptions } from './prompts/index.js';

export type { AgentEvent, GenerateViaAgentDeps } from './agent.js';
export { generateViaAgent } from './agent.js';
export type {
  CreateSessionOptions,
  PermissionDecision,
  PermissionHook,
  SessionHandle,
} from './agent-session.js';
export {
  AuthStorage,
  createCodesignSession,
  ModelRegistry,
  SessionManager,
} from './agent-session.js';
export {
  DESIGN_SKILL_FILES,
  type DesignSkillName,
  loadDesignSkills,
} from './design-skills/index.js';
export {
  PROVIDER_KEY_HELP_URL,
  remapProviderError,
  rewriteUpstreamMessage,
} from './errors.js';
export { FRAME_FILES, type FrameName, loadFrameTemplates } from './frames/index.js';
export type { CoreLogger } from './logger.js';
export type { LoadAllSkillsOptions } from './skills/index.js';
export { loadAllSkills, loadSkillsFromDir } from './skills/index.js';
export {
  type AskAnswer,
  type AskBridge,
  type AskInput,
  type AskQuestion,
  type AskResult,
  makeAskTool,
  validateAskInput,
} from './tools/ask.js';
export {
  type DoneDetails,
  type DoneError,
  type DoneRuntimeVerifier,
  makeDoneTool,
} from './tools/done.js';
export {
  type GenerateImageAssetDetails,
  type GenerateImageAssetFn,
  type GenerateImageAssetRequest,
  type GenerateImageAssetResult,
  makeGenerateImageAssetTool,
} from './tools/generate-image-asset.js';
export { type ListFilesDetails, makeListFilesTool } from './tools/list-files.js';
export {
  makePreviewTool,
  type PreviewResult,
  type RunPreviewFn,
  trimPreviewResult,
} from './tools/preview.js';
export {
  makeReadDesignSystemTool,
  type ReadDesignSystemDetails,
} from './tools/read-design-system.js';
export { makeReadUrlTool, type ReadUrlDetails } from './tools/read-url.js';
export { makeScaffoldTool, type ScaffoldDetails } from './tools/scaffold.js';
export { makeSetTitleTool, normalizeTitle, type SetTitleDetails } from './tools/set-title.js';
export { makeSetTodosTool, type SetTodosDetails } from './tools/set-todos.js';
export { makeSkillTool, type SkillDetails } from './tools/skill.js';
export {
  makeTextEditorTool,
  type TextEditorDetails,
  type TextEditorFsCallbacks,
} from './tools/text-editor.js';
export {
  aggregateTweaks,
  makeTweaksTool,
  parseTweakBlocks,
  type TweakBlock,
  type TweakEntry,
  type TweakFileInput,
  type TweaksDetails,
} from './tools/tweaks.js';
export type { PromptComposeOptions };

export interface AttachmentContext {
  name: string;
  path: string;
  excerpt?: string | undefined;
  note?: string | undefined;
  mediaType?: string | undefined;
  imageDataUrl?: string | undefined;
}

export interface ReferenceUrlContext {
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  excerpt?: string | undefined;
}

export interface GenerateInput {
  prompt: string;
  history: ChatMessage[];
  model: ModelRef;
  apiKey: string;
  /**
   * Optional async getter invoked once per agent turn so OAuth tokens can be
   * refreshed over a long tool-using run. Returns the current bearer token.
   * When omitted, the agent reuses the static `apiKey` captured at request
   * start — fine for providers with long-lived API keys.
   */
  getApiKey?: (() => Promise<string>) | undefined;
  baseUrl?: string | undefined;
  /** v3 wire — when set, pi-ai synthesizes a model for the wire protocol so
   * custom endpoints route correctly even if the provider id is unknown. */
  wire?: WireApi | undefined;
  /** v3 extra HTTP headers merged into the outbound request (gateway auth). */
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  /**
   * Per-call reasoning level override. Typically sourced from
   * `ProviderEntry.reasoningLevel`. When absent, core computes a default
   * via `reasoningForModel`.
   */
  reasoningLevel?: ReasoningLevel | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
  /** Absolute path to the current design's workspace on disk. When set, tools
   * that need to write files (e.g. `scaffold`) use this as the sandbox root. */
  workspaceRoot?: string | undefined;
  /**
   * Absolute path to the user-visible templates tree (typically
   * `<userData>/templates`). The agent reads scaffolds, skills, brand
   * references, frames, and design-skill starters from this directory.
   * When omitted, the scaffold / skill tools degrade to "not configured"
   * errors and builtin skill loading is skipped.
   */
  templatesRoot?: string | undefined;
  /** Override the system prompt entirely. When set, `mode` is ignored. */
  systemPrompt?: string | undefined;
  /**
   * Generation mode for this call. Only `'create'` is supported here.
   * Use `applyComment()` for `'revise'`; `'tweak'` has no public entry point yet.
   */
  mode?: Extract<PromptComposeOptions['mode'], 'create'> | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
  logger?: CoreLogger | undefined;
  /**
   * Optional workspace-glob reader. When provided, the agent wires up the
   * `tweaks` tool so the model can aggregate EDITMODE blocks across multiple
   * files. Main-process implementations pass a real glob-backed reader; unit
   * tests can stub with an in-memory map. When omitted, the `tweaks` tool
   * simply is not registered.
   */
  readWorkspaceFiles?:
    | ((patterns?: string[]) => Promise<Array<{ file: string; contents: string }>>)
    | undefined;
  /**
   * Optional host-injected preview executor. When provided, the agent gets
   * a `preview` tool it can call before `done` to render the artifact and
   * read back console / asset errors + a DOM outline (or screenshot on
   * vision-capable models).
   */
  runPreview?:
    | ((opts: {
        path: string;
        vision: boolean;
      }) => Promise<import('./tools/preview.js').PreviewResult>)
    | undefined;
  /**
   * Optional async bridge for the `ask` tool. When provided, the agent gains
   * an `ask` tool that pauses the turn, renders the questionnaire to the
   * user, and resumes with the collected answers.
   */
  askBridge?:
    | ((input: import('./tools/ask.js').AskInput) => Promise<import('./tools/ask.js').AskResult>)
    | undefined;
}

export interface ApplyCommentInput {
  html: string;
  comment: string;
  selection: SelectedElement;
  model: ModelRef;
  apiKey: string;
  /** Absolute path to the design's workspace root. The agent edits
   *  `<workspaceRoot>/index.html` directly via `text_editor`. */
  workspaceRoot: string;
  /** @see GenerateInput.templatesRoot */
  templatesRoot?: string | undefined;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  /** @see GenerateInput.reasoningLevel */
  reasoningLevel?: ReasoningLevel | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
  logger?: CoreLogger | undefined;
}

export interface GenerateOutput {
  message: string;
  artifacts: Artifact[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * Non-fatal issues surfaced during this generate call (e.g. builtin skill
   * loader failed). Callers MUST forward these to the UI — this is the
   * "no silent failure" escape hatch for best-effort substeps.
   */
  warnings?: string[];
}

export interface BuildApplyCommentPromptInput {
  comment: string;
  selection: SelectedElement;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
}

export function buildApplyCommentUserPrompt(input: BuildApplyCommentPromptInput): string {
  const contextSections = buildContextSections({
    ...(input.designSystem !== undefined ? { designSystem: input.designSystem } : {}),
    ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
  });
  const parts = [
    'Revise the HTML that is already in the workspace at `index.html`.',
    'Keep the overall structure, copy, and layout intact unless the user request requires a broader change.',
    'Prioritize the selected element first and avoid unrelated edits.',
    `User request: ${input.comment.trim()}`,
    `Selected element tag: <${input.selection.tag}>`,
    `Selected element selector: ${input.selection.selector}`,
    `Selected element snippet:\n${input.selection.outerHTML || '(empty)'}`,
  ];
  if (contextSections.length > 0) {
    parts.push(
      'You also have the following supporting context. Use it to preserve brand consistency while applying the requested change.',
    );
    parts.push(contextSections.join('\n\n'));
  }
  parts.push(
    'Edit the file with the `text_editor` tool — do NOT paste HTML in chat. When done, call the `done` tool. Keep the reply short; no narration beyond the required ≤15-word tool-call intros.',
  );
  return parts.join('\n\n');
}

export { composeSystemPrompt } from './prompts/index.js';

function _extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

/** Detect upstream-error messages that indicate a reasoning-knob mismatch.
 *  Phrases vary across upstreams (OpenRouter, Anthropic, OpenAI, Vertex, etc.),
 *  so use broad patterns over a long alternation rather than chasing exact
 *  strings — false positives only cost one extra request, false negatives
 *  surface to the user as an opaque 400. */
const REASONING_REQUIRED_PATTERNS = [
  /reasoning is mandatory/i,
  /reasoning is required/i,
  /requires reasoning/i,
  /thinking is mandatory/i,
  /thinking is required/i,
  /must (?:enable|provide|include) (?:reasoning|thinking)/i,
];
const REASONING_UNSUPPORTED_PATTERNS = [
  /does(?:n't| not) support (?:reasoning|thinking)/i,
  /(?:reasoning|thinking)(?: is)? not supported/i,
  /(?:reasoning|thinking)(?: is)? unsupported/i,
  /unknown (?:parameter|field).*reasoning/i,
  /unexpected (?:parameter|field).*reasoning/i,
  /(?:reasoning|thinking).*not allowed/i,
];

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

function _reasoningMismatch(
  err: unknown,
  sentReasoning: ReasoningLevel | undefined,
): 'add' | 'drop' | null {
  // Don't gate on extractStatus(err) === 400: pi-ai (and several upstream
  // SDKs) surface the HTTP code as a leading "400 ..." substring in the
  // message rather than as an `err.status` property. The reasoning patterns
  // below are specific enough that a false positive is highly unlikely; the
  // cost of one is a single extra request, while a false negative bubbles up
  // as an opaque PROVIDER_ERROR the user has no path to recover from.
  const msg = errorMessage(err);
  if (sentReasoning === undefined && REASONING_REQUIRED_PATTERNS.some((p) => p.test(msg))) {
    return 'add';
  }
  if (sentReasoning !== undefined && REASONING_UNSUPPORTED_PATTERNS.some((p) => p.test(msg))) {
    return 'drop';
  }
  return null;
}

/**
 * Output-token budget for every generation. Tripled from pi-ai's default
 * (~1/3 of context window, ~10k for Opus 4) to give Claude room for both
 * extended-thinking traces and a full HTML artifact.
 */
const _MAX_OUTPUT_TOKENS = 32000;

/** Match Anthropic's Claude 4.x family, which supports extended thinking. */
const CLAUDE_4_MODEL_RE = /claude-(?:opus|sonnet)-4/i;
/** OpenAI reasoning families (o-series and gpt-5). Anchored to the start of
 *  the modelId so a tenant prefix or pass-through path can't sneak through. */
const OPENAI_REASONING_MODEL_RE = /^(?:o1|o3|o4|gpt-5)(?:[-.].*)?$/i;
/** OpenRouter reasoning-mandatory model ids. These endpoints reject requests
 *  that do not declare a reasoning level (HTTP 400), so we MUST send one.
 *  Patterns are anchored to the org-prefix slugs OpenRouter uses; the explicit
 *  `:thinking` suffix covers Anthropic's thinking variants exposed via OR. */
const OPENROUTER_REASONING_MODEL_RE = new RegExp(
  [
    ':thinking$',
    '^anthropic/claude-(?:opus|sonnet)-4',
    '^openai/(?:o1|o3|o4|gpt-5)(?:[-.].*)?$',
    '^minimax/minimax-m\\d',
    '^deepseek/deepseek-r\\d',
    '^qwen/qwq',
  ].join('|'),
  'i',
);

export function reasoningForModel(
  model: ModelRef,
  baseUrl?: string | undefined,
): ReasoningLevel | undefined {
  // Proxy detection: when the provider id is 'anthropic' but baseUrl points
  // somewhere other than api.anthropic.com, we're talking to a Claude Code-
  // style proxy. Those commonly gate reasoning by plan and consumer-tier
  // accepts only 'medium'. Cap defaults at 'medium' so requests don't 400
  // out of the gate; users on higher-tier proxies override via Settings →
  // Reasoning depth.
  const looksLikeAnthropicProxy =
    model.provider === 'anthropic' &&
    baseUrl !== undefined &&
    baseUrl.length > 0 &&
    !/(^|\/\/)api\.anthropic\.com($|[/:])/i.test(baseUrl);

  switch (model.provider) {
    case 'anthropic':
      if (!CLAUDE_4_MODEL_RE.test(model.modelId)) return undefined;
      return looksLikeAnthropicProxy ? 'medium' : 'high';
    case 'openai':
      return OPENAI_REASONING_MODEL_RE.test(model.modelId) ? 'high' : undefined;
    case 'openrouter':
      // OpenRouter rejects reasoning-mandatory endpoints with 400 when no
      // reasoning level is declared. Use 'medium' (not 'high') as the default
      // — pi-ai may translate the knob differently across upstreams, and
      // 'medium' is a safer landing zone for unknown reasoning back-ends.
      return OPENROUTER_REASONING_MODEL_RE.test(model.modelId) ? 'medium' : undefined;
    case 'claude-code-imported':
      // Claude Code proxy endpoints gate reasoning tiers by plan — the
      // consumer-tier endpoint only accepts "medium". Sending "high" (or
      // letting pi-agent-core default up) yields a 400.
      return CLAUDE_4_MODEL_RE.test(model.modelId) ? 'medium' : undefined;
    default:
      return undefined;
  }
}

export async function applyComment(
  input: ApplyCommentInput,
  deps: GenerateViaAgentDeps = {},
): Promise<GenerateOutput> {
  const log = input.logger ?? NOOP_LOGGER;
  const ctx = {
    provider: input.model.provider,
    modelId: input.model.modelId,
  } as const;

  if (!input.comment.trim()) {
    throw new CodesignError('Comment cannot be empty', ERROR_CODES.INPUT_EMPTY_COMMENT);
  }
  if (!input.html.trim()) {
    throw new CodesignError('Existing HTML cannot be empty', ERROR_CODES.INPUT_EMPTY_HTML);
  }

  log.info('[apply_comment] step=build_request', ctx);
  const buildStart = Date.now();
  const systemPrompt = composeSystemPrompt({ mode: 'revise' });
  const userPrompt = buildApplyCommentUserPrompt({
    comment: input.comment,
    selection: input.selection,
    ...(input.designSystem !== undefined ? { designSystem: input.designSystem } : {}),
    ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
  });
  log.info('[apply_comment] step=build_request.ok', {
    ...ctx,
    ms: Date.now() - buildStart,
  });

  const agentInput: GenerateInput = {
    prompt: userPrompt,
    systemPrompt,
    history: [],
    model: input.model,
    apiKey: input.apiKey,
    workspaceRoot: input.workspaceRoot,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.wire !== undefined ? { wire: input.wire } : {}),
    ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.allowKeyless !== undefined ? { allowKeyless: input.allowKeyless } : {}),
    ...(input.reasoningLevel !== undefined ? { reasoningLevel: input.reasoningLevel } : {}),
    ...(input.designSystem !== undefined ? { designSystem: input.designSystem } : {}),
    ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
    ...(input.templatesRoot !== undefined ? { templatesRoot: input.templatesRoot } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.onRetry !== undefined ? { onRetry: input.onRetry } : {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  };
  return runAgent(agentInput, deps);
}

// ---------------------------------------------------------------------------
// Title generation — small synchronous completion used after the first prompt
// to replace "Untitled design" with a 2-5 word summary. Uses the same provider
// the user already configured so no extra key is needed. Failures bubble as
// CodesignError so the caller can choose a simple truncation recovery.
// ---------------------------------------------------------------------------

export interface GenerateTitleInput {
  prompt: string;
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  signal?: AbortSignal | undefined;
  logger?: CoreLogger | undefined;
}

const TITLE_SYSTEM_PROMPT = [
  'You write short titles for UI design projects.',
  'Output ONLY the title — 2 to 5 words, no quotes, no trailing punctuation, no emoji.',
  'Match the language the user wrote in (Chinese prompt → Chinese title).',
  'Describe WHAT is being designed, not the action verb.',
  'Good: "金融科技演讲稿", "Calm Spaces 冥想 App", "移动端引导流程".',
  'Bad: "A presentation for a fintech startup", "Design a slide deck for...".',
].join('\n');

function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/```[a-zA-Z0-9]*\n?|```/g, '')
    .replace(/^[\s'"“”‘’`*#\-•]+|[\s'"“”‘’`*#\-•。、，,.!?！？:：;；]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return '';
  // Guard against models that ignore the length hint and emit a paragraph.
  if (cleaned.length > 40) return `${cleaned.slice(0, 40).trimEnd()}…`;
  return cleaned;
}

export async function generateTitle(input: GenerateTitleInput): Promise<string> {
  const log = input.logger ?? NOOP_LOGGER;
  const trimmed = input.prompt.trim();
  if (trimmed.length === 0) {
    throw new CodesignError(
      'generateTitle requires a non-empty prompt',
      ERROR_CODES.INPUT_EMPTY_PROMPT,
    );
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: TITLE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Summarize this design prompt as a short title:\n\n${trimmed}`,
    },
  ];
  const started = Date.now();
  log.info('[title] step=send_request', {
    provider: input.model.provider,
    modelId: input.model.modelId,
  });
  try {
    const result = await completeWithRetry(
      input.model,
      messages,
      {
        apiKey: input.apiKey,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
        ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
        ...(input.allowKeyless === true ? { allowKeyless: true } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        maxTokens: 200,
      },
      {
        logger: log,
        provider: input.model.provider,
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
      },
    );
    log.info('[title] step=send_request.ok', { ms: Date.now() - started });
    const title = sanitizeTitle(result.content);
    if (title.length === 0) {
      throw new CodesignError('Model returned empty title', ERROR_CODES.PROVIDER_ERROR);
    }
    return title;
  } catch (err) {
    log.error('[title] step=send_request.fail', {
      ms: Date.now() - started,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    throw remapProviderError(err, input.model.provider, input.wire);
  }
}
