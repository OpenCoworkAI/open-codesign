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

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from '@mariozechner/pi-agent-core';
import type { Message as PiAiMessage, Model as PiAiModel } from '@mariozechner/pi-ai';
import type { RetryDecision, RetryReason } from '@open-codesign/providers';
import {
  classifyError,
  claudeCodeIdentityHeaders,
  filterActive,
  inferReasoning,
  looksLikeClaudeOAuthToken,
  normalizeGeminiModelId,
  shouldForceClaudeCodeIdentity,
  withBackoff,
} from '@open-codesign/providers';
import {
  type ChatMessage,
  CodesignError,
  canonicalBaseUrl,
  ERROR_CODES,
  type LoadedSkill,
  type ModelRef,
  type WireApi,
} from '@open-codesign/shared';
import type { TSchema } from '@sinclair/typebox';
import { buildTransformContext } from './context-prune.js';
import { remapProviderError } from './errors.js';
import type { GenerateInput, GenerateOutput } from './index.js';
import { reasoningForModel } from './index.js';
import { type Collected, createHtmlArtifact, stripEmptyFences } from './lib/artifact-collect.js';
import { buildContextSections, buildUserPromptWithContext } from './lib/context-format.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';
import { composeSystemPrompt } from './prompts/index.js';
import { makeAskTool } from './tools/ask.js';
import { type DoneRuntimeVerifier, makeDoneTool } from './tools/done.js';
import {
  type GenerateImageAssetFn,
  makeGenerateImageAssetTool,
} from './tools/generate-image-asset.js';
import { makePreviewTool } from './tools/preview.js';
import { loadScaffoldManifest, makeScaffoldTool } from './tools/scaffold.js';
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
// Resource-manifest loading — best-effort, never injects full skill bodies.
// ---------------------------------------------------------------------------

interface ResourceManifestResult {
  sections: string[];
  warnings: string[];
  skillCount: number;
  scaffoldCount: number;
  brandCount: number;
}

function oneLine(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function formatSkillSummary(skills: LoadedSkill[]): string[] {
  return [...skills]
    .sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name, 'en'))
    .map((skill) => `- ${skill.frontmatter.name}: ${oneLine(skill.frontmatter.description)}`);
}

async function listBrandRefs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `brand:${entry.name}`)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function formatScaffoldSummary(
  scaffolds: Record<string, { description: string; category?: string | undefined }>,
): string[] {
  const grouped = new Map<string, string[]>();
  for (const [kind, entry] of Object.entries(scaffolds).sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    const category = entry.category ?? 'other';
    const list = grouped.get(category) ?? [];
    list.push(`${kind} (${oneLine(entry.description, 72)})`);
    grouped.set(category, list);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([category, kinds]) => `- ${category}: ${kinds.slice(0, 8).join(', ')}`);
}

function buildResourceManifestSection(input: {
  skills: LoadedSkill[];
  scaffolds: Record<string, { description: string; category?: string | undefined }>;
  brandRefs: string[];
}): string | null {
  const skillLines = formatSkillSummary(input.skills);
  const scaffoldLines = formatScaffoldSummary(input.scaffolds);
  const brandLine =
    input.brandRefs.length > 0
      ? input.brandRefs.slice(0, 40).join(', ')
      : 'No built-in brand references available.';

  if (skillLines.length === 0 && scaffoldLines.length === 0 && input.brandRefs.length === 0) {
    return null;
  }

  return [
    '# Available Resources',
    '',
    'Progressive disclosure is manifest-first: choose from this index, then call `skill(name)` or `scaffold({kind, destPath})` before writing. Do not infer hidden prompt sections.',
    '',
    '## Design Skills',
    skillLines.length > 0 ? skillLines.join('\n') : 'No design skills available.',
    '',
    '## Scaffolds',
    scaffoldLines.length > 0 ? scaffoldLines.join('\n') : 'No scaffolds available.',
    '',
    '## Brand References',
    brandLine,
  ].join('\n');
}

async function collectResourceManifest(
  log: CoreLogger,
  providerId: string,
  templatesRoot: string | undefined,
): Promise<ResourceManifestResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const skillsRoot = templatesRoot ? path.join(templatesRoot, 'skills') : undefined;
  const scaffoldsRoot = templatesRoot ? path.join(templatesRoot, 'scaffolds') : undefined;
  const brandRefsRoot = templatesRoot ? path.join(templatesRoot, 'brand-refs') : undefined;
  let activeSkills: LoadedSkill[] = [];
  let scaffolds: Record<string, { description: string; category?: string | undefined }> = {};
  let brandRefs: string[] = [];

  if (!templatesRoot) {
    return { sections: [], warnings: [], skillCount: 0, scaffoldCount: 0, brandCount: 0 };
  }

  try {
    const { loadBuiltinSkills } = await import('./skills/loader.js');
    activeSkills = filterActive(await loadBuiltinSkills(skillsRoot ?? ''), providerId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    log.warn('[generate] step=load_resource_manifest.skills.fail', { errorClass, message });
    warnings.push(`Skill manifest unavailable: ${message}`);
  }

  try {
    if (scaffoldsRoot) {
      const manifest = await loadScaffoldManifest(scaffoldsRoot);
      scaffolds = manifest.scaffolds;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    log.warn('[generate] step=load_resource_manifest.scaffolds.fail', { errorClass, message });
    warnings.push(`Scaffold manifest unavailable: ${message}`);
  }

  try {
    if (brandRefsRoot) brandRefs = await listBrandRefs(brandRefsRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    log.warn('[generate] step=load_resource_manifest.brand_refs.fail', { errorClass, message });
    warnings.push(`Brand references unavailable: ${message}`);
  }

  const section = buildResourceManifestSection({ skills: activeSkills, scaffolds, brandRefs });
  log.info('[generate] step=load_resource_manifest.ok', {
    ms: Date.now() - start,
    skills: activeSkills.length,
    scaffolds: Object.keys(scaffolds).length,
    brandRefs: brandRefs.length,
    warnings: warnings.length,
  });
  return {
    sections: section ? [section] : [],
    warnings,
    skillCount: activeSkills.length,
    scaffoldCount: Object.keys(scaffolds).length,
    brandCount: brandRefs.length,
  };
}

// ---------------------------------------------------------------------------
// Tool-use guidance appended to the system prompt when agentic tools are
// active. Keeps the base prompt (shared with the non-agent path) unchanged.
// ---------------------------------------------------------------------------

const AGENTIC_TOOL_GUIDANCE = [
  '## Workspace output contract',
  '',
  '- Write the deliverable to workspace file `index.html` with `str_replace_based_edit_tool`; do not treat chat text as the artifact.',
  '- Create files with `{ "command": "create", "path": "index.html", "file_text": "..." }`; follow-up edits use `view`, `str_replace`, or `insert`.',
  '- Do not emit `<artifact>` tags, fenced source blocks, raw HTML/JSX/CSS, or HTML document wrappers in chat.',
  '- Local workspace assets and scaffolded files are allowed. External scripts remain restricted by the base output rules.',
  '- Assistant text is for brief progress notes and final rationale only.',
  '',
  '## Required tool loop',
  '',
  '1. Call `set_title` once and `set_todos` for multi-step work.',
  '2. Use the manifest: call `skill(name)` or `scaffold({kind, destPath})` before relying on optional guidance or starter files.',
  '3. Write `index.html` through `str_replace_based_edit_tool`.',
  '4. Call `preview(path)` after the first substantive pass when available.',
  '5. Call `tweaks()` for editable controls when the artifact has meaningful EDITMODE values.',
  '6. Call `done(path)` before finishing; fix returned errors and stop after 3 verification rounds.',
  '',
  '## File-edit discipline',
  '',
  '- Keep `old_str` small and unique. Large replacements waste context and are fragile.',
  '- Never view just to check whether an edit succeeded; the tool reports failures.',
  '- Interleave brief prose with tool calls so the user can follow progress.',
].join('\n');

const IMAGE_ASSET_TOOL_GUIDANCE = [
  '## Bitmap asset generation',
  '',
  'You also have `generate_image_asset` for high-quality bitmap assets.',
  'Use it when the brief asks for, or clearly benefits from, a generated hero image, product image, poster illustration, painterly/photo background, marketing visual, or brand/logo-like bitmap.',
  '',
  'MANDATORY asset inventory (do this BEFORE any `str_replace_based_edit_tool` call that writes `index.html`):',
  '1. Re-read the user brief and list every distinct visual asset it names or strongly implies: background / hero / logo / product / illustration / poster / mascot / texture / avatar, etc.',
  '2. For each item in that list, decide exactly one of: `generate_image_asset` (bitmap), inline `<svg>` (pure geometric / flat brand-mark / icon), or pure CSS (gradients, patterns). Record the decision.',
  '3. Emit ALL chosen `generate_image_asset` calls together in a single assistant turn — do NOT start writing or editing `index.html` until every required bitmap asset has been requested.',
  '',
  'When the brief explicitly asks for a bitmap for a given slot (e.g. "生图做 bg 和 logo", "generate a hero image and a product shot"), you MUST call `generate_image_asset` for each of those slots. One call per named asset. Do NOT collapse multiple named assets into a single call, and do NOT silently substitute SVG/CSS for one of them and bitmap for the other — that violates the brief.',
  '',
  'Default choices when the brief is ambiguous:',
  "- Logo: if the user asked for it to be *generated* / *illustrated* / *rendered* / any language implying a painted or photographic mark → `generate_image_asset` with `purpose='logo'`, `aspectRatio='1:1'`. Use inline SVG only when the user clearly wants a flat geometric wordmark or when no logo was requested at all.",
  '- Background / hero / poster / marketing illustration: always `generate_image_asset` unless the brief explicitly says "no images" or "CSS-only".',
  '- Decorative gradients, UI chrome, charts, simple icons (search, menu, arrow, etc.): use HTML/CSS/SVG, never `generate_image_asset`.',
  '',
  'Timing: each call is synchronous and takes ~20–60 seconds. To minimise wall-clock time:',
  '- Finish the asset inventory above FIRST, then emit every `generate_image_asset` call in ONE turn before touching `index.html`.',
  '- The host runs tool calls back-to-back within a turn, so batching N image calls costs ~N × 30s of wall clock, but sprinkling them across turns costs N × (image time + LLM round-trip) which is much slower.',
  '- Never interleave one image call with HTML edits — that serialises the waits across many LLM round trips.',
  '',
  'When you call it:',
  '- Provide a production-ready visual prompt: subject, medium/style, composition, lighting, palette, and any text constraints.',
  '- Pick the most accurate `purpose` (hero / product / poster / background / illustration / logo / other) — the host appends structural constraints (composition, overlay-safety, no-text) based on it.',
  '- Set `aspectRatio` to match where the image lands (16:9 heroes, 9:16 mobile, 1:1 logos, etc.) — the host maps it to a concrete size.',
  '- Provide a meaningful `alt` and optional `filenameHint` (used as the asset stem).',
  '- Use the returned local `assets/...` path in `index.html`, e.g. `<img src="assets/hero.png" alt="...">` or `backgroundImage: "url(\'assets/hero.png\')"`. The host resolves those local paths for preview and persistence.',
].join('\n');

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
   * these callbacks. When undefined, only `set_todos` is included.
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
    : await collectResourceManifest(log, input.model.provider, input.templatesRoot);
  const systemPrompt =
    input.systemPrompt ??
    composeSystemPrompt({
      mode: 'create',
      userPrompt: input.prompt,
      ...(resourceResult.sections.length > 0 ? { resources: resourceResult.sections } : {}),
    });

  const userContent = buildUserPromptWithContext(
    input.prompt,
    buildContextSections({
      ...(input.designSystem !== undefined ? { designSystem: input.designSystem } : {}),
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
    }),
  );

  // Assemble the toolset. Caller can pass an explicit list (including []) to
  // override the default. Defaults:
  //   - set_todos       (always — no deps)
  //   - str_replace_based_edit_tool + done (when fs callbacks are provided)
  //
  // No generic network-fetch tool is installed here: external fetches must go
  // through the host's permissioned tool path. DESIGN.md context is injected
  // into the prompt instead of fetched through a side tool.
  const scaffoldsRoot = input.templatesRoot ? path.join(input.templatesRoot, 'scaffolds') : null;
  const brandRefsRoot = input.templatesRoot ? path.join(input.templatesRoot, 'brand-refs') : null;
  const defaultTools: AgentTool<TSchema, unknown>[] = [];
  defaultTools.push(makeSetTodosTool() as unknown as AgentTool<TSchema, unknown>);
  defaultTools.push(makeSetTitleTool() as unknown as AgentTool<TSchema, unknown>);
  const loadedSkills = new Set<string>();
  defaultTools.push(
    makeSkillTool({
      dedup: loadedSkills,
      skillsRoot: skillsBuiltinDir ?? null,
      brandRefsRoot,
    }) as unknown as AgentTool<TSchema, unknown>,
  );
  defaultTools.push(
    makeScaffoldTool(
      () => input.workspaceRoot ?? null,
      () => scaffoldsRoot,
    ) as unknown as AgentTool<TSchema, unknown>,
  );
  if (deps.fs) {
    defaultTools.push(makeTextEditorTool(deps.fs) as unknown as AgentTool<TSchema, unknown>);
    defaultTools.push(
      makeDoneTool(deps.fs, deps.runtimeVerify) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  if (input.runPreview) {
    const vision = piModel.input?.includes('image') === true;
    defaultTools.push(
      makePreviewTool(input.runPreview, { vision }) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  if (deps.generateImageAsset) {
    defaultTools.push(
      makeGenerateImageAssetTool(deps.generateImageAsset, deps.fs, log) as unknown as AgentTool<
        TSchema,
        unknown
      >,
    );
  }
  if (input.readWorkspaceFiles) {
    defaultTools.push(
      makeTweaksTool(input.readWorkspaceFiles) as unknown as AgentTool<TSchema, unknown>,
    );
  }
  if (input.askBridge) {
    defaultTools.push(makeAskTool(input.askBridge) as unknown as AgentTool<TSchema, unknown>);
  }
  const tools = deps.tools ?? defaultTools;
  const encourageToolUse = deps.encourageToolUse ?? tools.length > 0;
  const activeGuidance = deps.generateImageAsset
    ? `${AGENTIC_TOOL_GUIDANCE}\n\n${IMAGE_ASSET_TOOL_GUIDANCE}`
    : AGENTIC_TOOL_GUIDANCE;
  const augmentedSystemPrompt = encourageToolUse
    ? `${systemPrompt}\n\n${activeGuidance}`
    : systemPrompt;

  // Seed the transcript with prior history (already in ChatMessage shape).
  const historyAsAgentMessages: AgentMessage[] = input.history.map((m, idx) =>
    chatMessageToAgentMessage(m, idx + 1, piModel),
  );
  log.info('[generate] step=build_request.ok', {
    ...ctx,
    ms: Date.now() - buildStart,
    messages: historyAsAgentMessages.length + 2,
    skills: resourceResult.skillCount,
    scaffolds: resourceResult.scaffoldCount,
    brandRefs: resourceResult.brandCount,
    resourceWarnings: resourceResult.warnings.length,
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
  const agent = new Agent({
    initialState: {
      systemPrompt: augmentedSystemPrompt,
      model: piModel as unknown as PiAiModel<'openai-completions'>,
      messages: historyAsAgentMessages,
      tools,
      thinkingLevel,
    },
    convertToLlm: (messages) =>
      messages.filter(
        (m): m is PiAiMessage =>
          m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
      ),
    // Sliding-window compaction — stubs toolResult.content for rounds older
    // than the last 8 (or 4 if total size still exceeds the safety cap).
    // Without this, assistant.toolCall.input + big view results grow O(N²)
    // in LLM-facing size across a long tool-using run and blow past 1 M
    // tokens. See context-prune.ts for the full strategy.
    transformContext: buildTransformContext(log),
    // Async getter so OAuth tokens can be refreshed between agent turns. On a
    // long tool-using run, `input.apiKey` captured at start-of-request would
    // eventually expire; the caller passes `input.getApiKey` for codex so each
    // LLM round-trip calls into the token store (which auto-refreshes inside
    // its 5-min buffer). We stash any throw in `capturedGetApiKeyError` so
    // the post-agent branch below can rethrow the original structured error
    // — otherwise pi-agent-core's plain-string failure shape would cause us
    // to downgrade to PROVIDER_ERROR, hiding the sign-in-again affordance.
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
    const listener = deps.onEvent;
    agent.subscribe((event) => {
      listener(event);
    });
  }

  if (input.signal) {
    if (input.signal.aborted) {
      agent.abort();
    } else {
      input.signal.addEventListener('abort', () => agent.abort(), { once: true });
    }
  }

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

  const finalAssistant = findFinalAssistantMessage(agent.state.messages);
  if (!finalAssistant) {
    throw new CodesignError('Agent produced no assistant message', ERROR_CODES.PROVIDER_ERROR);
  }
  if (finalAssistant.stopReason !== 'stop') {
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

  // The agent writes artifacts through str_replace_based_edit_tool — final
  // assistant text is prose, not an `<artifact>` blob. Pull index.html out of
  // the virtual FS to populate the artifact list.
  if (deps.fs) {
    const file = deps.fs.view('index.html');
    if (file !== null && file.content.trim().length > 0) {
      collected.artifacts.push(createHtmlArtifact(file.content, 0));
    }
  }
  log.info('[generate] step=parse_response.ok', {
    ...ctx,
    ms: Date.now() - parseStart,
    artifacts: collected.artifacts.length,
  });

  const usage = finalAssistant.usage;
  const output: GenerateOutput = {
    message: stripEmptyFences(collected.text),
    artifacts: collected.artifacts,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    costUsd: usage?.cost?.total ?? 0,
  };
  return resourceResult.warnings.length > 0
    ? { ...output, warnings: [...(output.warnings ?? []), ...resourceResult.warnings] }
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
