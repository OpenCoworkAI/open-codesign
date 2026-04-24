/**
 * Workstream B — Phase 1 agent-runtime wrapper.
 *
 * Routes a `generate()`-shaped request through `@mariozechner/pi-agent-core`
 * with an empty tool list. Purpose: de-risk the runtime integration before
 * Phase 2 introduces real tools (str_replace_based_edit_tool, set_todos,
 * load_skill, verify_syntax). When `USE_AGENT_RUNTIME` is off this file is
 * not imported, so behavior for existing users is unchanged.
 *
 * Design doc: docs/plans/2026-04-20-agentic-sidebar-custom-endpoint-design.md §4.
 *
 * Divergences from the design-doc §4.4 sketch (documented here for Workstream C
 * to plan against):
 *   - pi-agent-core's `Agent` does NOT accept `model` / `systemPrompt` / `tools`
 *     as top-level constructor args. They live in `options.initialState`.
 *   - There is no `agent.run()` method returning `{finalText, usage}`. Instead
 *     we call `agent.prompt(userMessage)` (Promise<void>) and read the final
 *     assistant message + usage from `agent.state.messages` after settlement.
 *   - The stream delta event is `message_update` with
 *     `assistantMessageEvent.type === 'text_delta'`, NOT a top-level `text_delta`
 *     event. Callers see `turn_start` / `turn_end` / `message_*` lifecycle
 *     events directly via `onEvent`.
 */

import path from 'node:path';
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from '@mariozechner/pi-agent-core';
import type { Message as PiAiMessage, Model as PiAiModel } from '@mariozechner/pi-ai';
import { createArtifactParser } from '@open-codesign/artifacts';
import type { RetryDecision, RetryReason } from '@open-codesign/providers';
import {
  classifyError,
  claudeCodeIdentityHeaders,
  looksLikeClaudeOAuthToken,
  shouldForceClaudeCodeIdentity,
  withBackoff,
} from '@open-codesign/providers';
import {
  type ChatMessage,
  CodesignError,
  canonicalBaseUrl,
  ERROR_CODES,
  type ModelRef,
  type WireApi,
} from '@open-codesign/shared';
import type { TSchema } from '@sinclair/typebox';
import { buildTransformContext } from './context-prune.js';
import { remapProviderError } from './errors.js';
import type { GenerateInput, GenerateOutput } from './index.js';
import { reasoningForModel } from './index.js';
import {
  type Collected,
  collect,
  createHtmlArtifact,
  stripEmptyFences,
} from './lib/artifact-collect.js';
import { buildContextSections, buildUserPromptWithContext } from './lib/context-format.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';
import { composeSystemPrompt } from './prompts/index.js';
import { makeAskTool } from './tools/ask.js';
import { type DoneRuntimeVerifier, makeDoneTool } from './tools/done.js';
import {
  type GenerateImageAssetFn,
  makeGenerateImageAssetTool,
} from './tools/generate-image-asset.js';
import { makeListFilesTool } from './tools/list-files.js';
import { makePreviewTool } from './tools/preview.js';
import { makeReadDesignSystemTool } from './tools/read-design-system.js';
import { makeReadUrlTool } from './tools/read-url.js';
import { makeScaffoldTool } from './tools/scaffold.js';
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
// Note: extractFallbackArtifact / extractHtmlDocument were removed in favour of
// the text_editor + virtual fs path. See `if (collected.artifacts.length === 0
// && deps.fs)` below for the only supported recovery.

// ---------------------------------------------------------------------------
// Model resolution — unified single path. We never query pi-ai's registry;
// instead we build the pi-ai Model shape directly from `cfg.providers[id]`
// (wire + baseUrl + modelId). This means:
//   - builtin providers (anthropic/openai/openrouter) take the same path as
//     imported ones (claude-code-imported, codex-*, custom proxies)
//   - there is no "unknown model" error — a missing entry is a config bug
//     the caller must surface, not a fallback to swallow
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
  // openai-chat is the canonical fallback for everything else that uses the
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
  // those endpoints (api.anthropic.com is anthropic), not a fallback to a
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
  const out: PiModel = {
    id: model.modelId,
    name: model.modelId,
    api: apiForWire(wire),
    provider: model.provider,
    baseUrl: canonicalBase,
    reasoning: true,
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
// Skill loading — best-effort, matches generate() behavior.
// ---------------------------------------------------------------------------

async function collectSkills(
  log: CoreLogger,
  providerId: string,
  builtinDir: string | undefined,
): Promise<{ blobs: string[]; warnings: string[] }> {
  const start = Date.now();
  try {
    const { loadBuiltinSkills } = await import('./skills/loader.js');
    const { filterActive, formatSkillsForPrompt } = await import('@open-codesign/providers');
    const skills = await loadBuiltinSkills(builtinDir ?? '');
    const active = filterActive(skills, providerId);
    const blobs = formatSkillsForPrompt(active);
    log.info('[generate] step=load_skills.ok', {
      ms: Date.now() - start,
      skills: blobs.length,
    });
    return { blobs, warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    log.warn('[generate] step=load_skills.fail', { errorClass, message });
    return { blobs: [], warnings: [`Builtin skills unavailable: ${message}`] };
  }
}

// ---------------------------------------------------------------------------
// Tool-use guidance appended to the system prompt when agentic tools are
// active. Keeps the base prompt (shared with the non-agent path) unchanged.
// ---------------------------------------------------------------------------

const AGENTIC_TOOL_GUIDANCE = [
  '## OVERRIDE: artifact-wrapper rules do not apply in this mode',
  '',
  'The base system prompt (output-rules §"Artifact wrapper", workflow step 7 ',
  '"Deliver — Output the artifact tag") instructs you to emit the design ',
  'inside an `<artifact>...</artifact>` tag as assistant text. **Those rules ',
  'are superseded by this section.** You have a `str_replace_based_edit_tool`; ',
  'the file is written via that tool and extracted from the virtual filesystem ',
  'by the host. Emitting the file contents as assistant text (either wrapped in ',
  '`<artifact>`, a ```jsx fence, or raw) duplicates the design, doubles token ',
  'cost, and blows past the LLM context limit on the next turn. Never do it.',
  '',
  '## Output format (STRICT — no exceptions)',
  '',
  'Your artifact lives in `index.html` and follows this template — write it via',
  '`text_editor.create("index.html", ...)`:',
  '',
  '```jsx',
  'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{',
  "  // tokens the user can tweak via the host's slider panel",
  '  "accentColor": "#CC785C",',
  '  "headingWeight": 500',
  '}/*EDITMODE-END*/;',
  '',
  'const T = {',
  '  // your design tokens (compose from TWEAK_DEFAULTS + literals)',
  '};',
  '',
  'function App() {',
  '  return <div>...</div>;',
  '}',
  '',
  'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
  '```',
  '',
  'The host wraps this in an iframe that pre-loads:',
  '  - React 18 + ReactDOM (window.React, window.ReactDOM)',
  '  - @babel/standalone (transpiles your script at runtime)',
  '  - ios-frame.jsx → window.{IOSDevice, IOSStatusBar, IOSGlassPill, IOSNavBar, IOSList, IOSListRow, IOSKeyboard}',
  '  - design-canvas.jsx → window.{DesignCanvas, DCSection, DCArtboard, DCPostIt}',
  '  - Google Fonts: Fraunces, DM Serif Display, DM Sans, JetBrains Mono',
  '',
  'So you can write `<IOSDevice>...</IOSDevice>` directly without imports.',
  '',
  '### EDITMODE rules',
  '- Always include the EDITMODE-BEGIN/END block, even if empty `{}`.',
  '- Tokens are JSON-serializable: string / number / boolean / array / object of primitives.',
  '- Reference them as `TWEAK_DEFAULTS.accentColor` in your JSX.',
  "- Don't rewrite the marker block at runtime; the host edits it.",
  '',
  '### Required cadence',
  '1. **First turn — plan.** Call `set_todos` with **7–10 checklist items** naming concrete sections AND an explicit `Interactive polish` step near the end (e.g. "Hero", "Metrics row", "CFO pull quote", "How we did it", "Logo strip", "Interactive polish: hover/press, tabs, empty states", "Final proof-read"). Each item is a single component or refinement pass — not "Build page". Mark all unchecked.',
  '2. **Second turn — skeleton.** Use `text_editor.create("index.html", ...)` to write a minimal scaffold: the EDITMODE block, an empty `App` returning a basic layout container, and the `ReactDOM.createRoot` line. **Do not** include any section content yet. Then `set_todos` with skeleton ticked.',
  '3. **One section per turn — fill.** For each remaining todo, in its own turn:',
  '   1. One short prose line announcing what you\'re about to do ("Adding the metrics row now.").',
  '   2. `view` the file (1 call).',
  "   3. `str_replace` to add ONE section's JSX (1 call).",
  '   4. One short prose line reflecting on what landed ("Three KPIs in place — the deltas use mono tnum so they line up.").',
  '   5. Tick the matching todo via `set_todos`.',
  '   That is **2 prose lines + 3 tool calls per turn**. Never batch multiple sections into a single str_replace; never run two str_replace tools in the same turn without a prose line in between.',
  '4. **Polish passes — interactive depth (MANDATORY, ≥2 dedicated turns).** The first polish turn wires interactions; the second adds small-detail craft. These are NOT optional — if the user sees static pixels where they expected live UI, the artifact fails. Before `done` every item on this list must be TRUE:',
  '   (a) **≥3 functional state changes** that a user can trigger and observe. Tab switch revealing a different view, accordion open/close, drawer slide-in, favorite/like toggle that persists, dropdown/menu expand, inline-edit, filter chip toggle, modal open. Pure hover effects do NOT count toward this three.',
  '   (b) **≥1 animated view/page transition** if there is any nav (tabs, sidebar, bottom bar, breadcrumbs). 180–260ms, opacity + small translate. A hard cut between views is a failure.',
  '   (c) **Every `<button>` and `<a>` does something.** No decorative buttons. Wire a state change, open a modal, fire a toast, or remove it. Login / Sign-up / CTA buttons on marketing pages may open a modal stub — still real, not dead.',
  '   (d) **Uniform hover + press + focus** across ALL clickable elements. Required cadence: `transition: transform 120ms var(--ease-out), background-color 120ms, box-shadow 160ms;` hover lifts 2px; press = `scale(0.96)`; focus = 2px offset ring in accent color (never rely on browser default outline).',
  '   (e) **≥3 small-detail "craft-surplus" touches** from the craft-directives catalog. Pick from: stateful counter/badge with pop animation, keyboard shortcut chip (`⌘K`, `/`, `esc`), inline-editable field, copy-to-clipboard with "Copied ✓" feedback, dismissible toast/banner, contextual tooltip with directional arrow, scroll-linked header shrink, relative-time tick ("3m ago"), segmented control with weighted active state, thoughtful empty-state SVG scene, expandable accordion inside a card, a deliberate visual rhythm-break section. Adding a gradient and shadow does NOT count.',
  '   (f) **≥1 empty-state variant** visible or coded (icon + one-sentence reason + CTA) on a list/grid/table, even when current data is non-empty.',
  '   (g) **Active nav indicator uses weight/shape, not color alone** — underline, inset background, side-accent bar, or pill — so color-blind users can tell where they are.',
  '   (h) Data reads real: varied names, non-round numbers (87 %, $14.2k), relative dates ("3h ago", "yesterday"), not Lorem / 100 % / Jan 1 2020.',
  '   Break this into TWO todo items: `Interactive wiring (state + transitions)` and `Craft surplus (small details)`. Tick them explicitly so the user can see both phases landed.',
  '5. **Final turn — summary.** 2–4 sentences of natural-language prose explaining 2–3 design decisions worth noting (e.g. "Used three distinct surface tones for depth"). Do NOT re-emit the file content; the host extracts it from the virtual fs. Pasting the full file here wastes ~2M tokens on the next turn and will crash the request — this is a hard failure, not a style nit.',
  '',
  '### File output policy (STRICT)',
  "- Use `str_replace_based_edit_tool` for ALL file content. Do NOT emit `<artifact>` tags or fenced ```jsx/```html blocks containing the source in your prose — the host extracts the artifact from the virtual fs and any inline source spams the user's chat.",
  '- Your assistant text is for explanation, planning, and progress notes only.',
  '- Prefer small, specific `old_str` values so each edit is unambiguous.',
  '- Minimum 6 tool calls per design; 10–15 is typical.',
  '',
  '### Token-budget discipline (CRITICAL)',
  '- `view("index.html")` WITHOUT `view_range` returns the ENTIRE file — each call accumulates in your context window.',
  '- **Full-file view at most ONCE per generation run**: right before your first `str_replace`, for initial orientation. After that the file WILL grow with every edit, so a second full-file view becomes very expensive.',
  '- **For any re-inspection after the first view, pass `view_range`** — it takes `[startLine, endLine]` (1-indexed, inclusive; either bound may be `-1` for "end of file"). Examples:',
  '    `view("index.html", view_range: [1, 40])` — re-read the top 40 lines to check imports / EDITMODE block',
  '    `view("index.html", view_range: [200, 260])` — re-inspect a section you just edited',
  '    `view("index.html", view_range: [-1, -1])` — wrong; use a real line number for start',
  '- A second full-file view (no `view_range`) within the same run auto-truncates to a 400-char head snippet — the host enforces this to protect the context window. If you need to see a region, issue a ranged view; if you just need to pick an `old_str`, work from memory of the first view.',
  '- Never `view` "just to verify" a str_replace succeeded — the tool reports errors when it fails; silence means success. Use `done` for verification, not re-view.',
  '- Keep `str_replace` edits tight: `old_str` should be the minimum unique anchor (often 1-3 lines), and `new_str` should be the new JSX only. Large old_str + new_str pairs also live in context.',
  '',
  '## Frames (optional starters)',
  '',
  'For mobile / tablet / watch / desktop shells, view one of these first:',
  '',
  '  frames/iphone.jsx       — iPhone 16 Pro shell (Dynamic Island + home indicator)',
  '  frames/ipad.jsx         — iPad chrome',
  '  frames/watch.jsx        — Apple Watch Ultra (digital crown + side buttons)',
  '  frames/android.jsx      — Android Material 3 phone (gesture or 3-button nav)',
  '  frames/macos-safari.jsx — macOS Safari window (traffic lights + tabs)',
  '',
  'Frame files export their device components onto window (e.g. `AppleWatchUltra`, `AndroidPhone`, `MacOSSafari`) so you can drop them straight into your `App` after copying.',
  '',
  '## Design skills (optional starter snippets)',
  '',
  'For common patterns, view the matching skill before writing:',
  '',
  '  skills/slide-deck.jsx',
  '  skills/dashboard.jsx',
  '  skills/landing-page.jsx',
  '  skills/chart-svg.jsx',
  '  skills/glassmorphism.jsx',
  '  skills/editorial-typography.jsx',
  '  skills/heroes.jsx       — 5 hero section variants',
  '  skills/pricing.jsx      — 4 pricing variants',
  '  skills/footers.jsx      — 4 footer variants',
  '  skills/chat-ui.jsx      — Chat UI primitives (bubbles, thinking, tool cards)',
  '  skills/data-table.jsx   — Data table with sortable / filterable',
  '  skills/calendar.jsx     — Month-view calendar',
  '',
  'Each declares a `// when_to_use:` hint at the top — read it before adopting.',
  '',
  '## Multi-view designs — when the brief implies navigation',
  '',
  'Many briefs (landing + pricing, product + docs, app with dashboard/settings/',
  'inbox, multi-step onboarding) need more than one surface. The preview',
  'sandbox has NO routing and blocks `<a href="/route">` navigation — clicking',
  'any link with a real href would blank the iframe. So:',
  '',
  '**Always build multi-view designs as React view-state in one App**, not with',
  'href navigation. Pattern:',
  '',
  '```jsx',
  'function App() {',
  '  const [view, setView] = React.useState("home");',
  '  return (',
  '    <>',
  '      <Nav current={view} onNavigate={setView} />',
  '      {view === "home" && <HomeView/>}',
  '      {view === "pricing" && <PricingView/>}',
  '      {view === "docs" && <DocsView/>}',
  '    </>',
  '  );',
  '}',
  '```',
  '',
  'Nav buttons use `onClick={() => setView(...)}`, NOT `<a href>`. If you must',
  'use `<a>` for visual reasons, make it `<a href="#" onClick={e => { e.preventDefault(); setView(...); }}>`.',
  '',
  'When the brief implies depth, produce **3–5 distinct views**. Each view',
  'should:',
  '- Have its own section mix (pricing page has a table + FAQ; dashboard has',
  "  KPI grid + chart + activity feed) — don't repeat the same hero across",
  '  every view.',
  '- Reach end-to-end: real content, real data, real empty-states — not',
  '  placeholders like "Content goes here".',
  '- Feel weighty: 4–8 sections per view, 800–1500 px of vertical content.',
  '',
  'For depth inside a single view (accordions, tabs, modals, drawers, detail',
  'slide-overs) prefer local component state over global view-state.',
  '',
  '## Component reference discipline (CRITICAL — preview crashes otherwise)',
  '',
  "The iframe's `done` verifier loads your artifact for ~3 seconds and captures",
  'console errors for **whatever actually renders** during that window. Tabs that',
  'are not the default active tab, modals / drawers that are closed on load,',
  'accordion panels that start collapsed — none of their JSX executes, so a',
  "`<UndefinedComponent />` inside them slips past `done` and crashes the user's",
  'preview the moment they click the trigger.',
  '',
  '**Before every `done` call, audit your own file:**',
  '- For every `<PascalCase/>` or `<PascalCase>...</PascalCase>` tag in the JSX,',
  '  confirm a matching `function PascalCase` or `const PascalCase = ...` exists',
  '  in the same file (or is provided by the runtime: React, ReactDOM, IOSDevice,',
  '  IOSStatusBar, IOSGlassPill, IOSNavBar, IOSList, IOSListRow, IOSKeyboard,',
  '  DesignCanvas, DCSection, DCArtboard, DCPostIt, AppleWatchUltra, AndroidPhone,',
  '  MacOSSafari — that is the complete window-scope list).',
  '- Strategy: do a final `str_replace` pass that alphabetises a comment header',
  '  listing all components you define (e.g. `// Components: App, Nav, Hero,',
  '  Inbox, InputBar, MessageList, Sidebar`) so the list is grep-findable.',
  '- If you introduced a tab / modal / drawer in a polish turn, ensure every',
  '  component it references is defined — NOT just the default view.',
  '',
  'Common failure modes to avoid:',
  '- Copy-pasted a `<ChatInput />` from a skill file, forgot to copy the',
  '  definition along with it.',
  '- Renamed `InputBar` → `MessageComposer` but left one stray `<InputBar />`',
  '  reference in a secondary tab.',
  '- Planned to use a future component (`<FooChart />`) as a stub, left the',
  '  call in the JSX.',
  '',
  '## Self-check via `done`',
  '',
  '### TWEAK_SCHEMA — declare control hints for the tweak panel',
  '',
  'After your artifact is otherwise complete and `TWEAK_DEFAULTS` is stable,',
  'call `declare_tweak_schema` ONCE to tell the host how to render each token',
  'in the live Tweak panel. The host injects (or replaces) a sibling block:',
  '',
  '```jsx',
  'const TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{ ... }/*TWEAK-SCHEMA-END*/;',
  '```',
  '',
  'right after `TWEAK_DEFAULTS`. Calling it again replaces the previous schema.',
  '',
  '**Picking a kind for each token**',
  '- Hex / rgb color string → `{ kind: "color" }`',
  '- Number that is a CSS pixel value → `{ kind: "number", min, max, step, unit: "px" }`',
  '  - Padding / radius / gap: `min: 0, max: 32, step: 2`',
  '  - Font size:               `min: 12, max: 72, step: 1`',
  '  - Border / stroke width:   `min: 0, max: 8, step: 1`',
  '- A small fixed set of string options (e.g. density, variant) → `{ kind: "enum", options: [...] }`',
  '- True/false flag → `{ kind: "boolean" }`',
  '- Free-form text (heading, label, caption) → `{ kind: "string", placeholder: "Hint text" }`',
  '',
  "Tokens you leave out of the schema fall back to the host's heuristic, so it",
  'is fine to declare hints only for the tokens whose UI matters.',
  '',
  'Call `declare_tweak_schema` BEFORE `done` so the schema block is part of the',
  'artifact that `done` verifies. Do not declare schema for tokens that are not',
  'in `TWEAK_DEFAULTS` — they will be silently ignored.',
  '',
  'After producing a complete artifact, call `done` to verify it. The host runs',
  'two checks: (a) static syntax lint (unclosed tags, duplicate IDs, missing',
  'alt) and (b) a real runtime load — your JSX is mounted in a hidden',
  'BrowserWindow for ~3s, and any console errors / warnings or load failures',
  'come back as `errors`. If `status === "has_errors"`, fix with `str_replace`',
  'and call `done` again. Stop after 3 rounds.',
  '',
  '**Important limitation of `done`:** the runtime load only exercises whatever',
  'renders on first paint. Hidden tabs, closed modals, collapsed accordions,',
  'and drawer bodies never execute, so their `<UndefinedComponent />` bugs',
  'survive. Before each `done` call, **manually audit component references**',
  'per the "Component reference discipline" section above — this is your',
  "responsibility, not `done`'s.",
  '',
  '## Pacing — interleave tool calls and prose',
  '',
  'Do not batch every tool call up-front and then dump a wall of text at the',
  'end. The chat UI shows tool rows and assistant text bubbles in arrival',
  'order, so a long silent run feels like a black box.',
  '',
  'Aim for a rhythm like:',
  '  brief intro text  →  1-3 tool calls  →  one-line progress / reflection',
  '  →  next 1-3 tool calls  →  one-line note  →  …  →  final summary',
  '',
  'Each prose line should be short (≤2 sentences) and explain *what just',
  'happened* or *what comes next* — not summarize the file content (the user',
  'sees that in the live preview). Avoid repeating yourself across turns.',
  '',
  '## Typography rules',
  '',
  'Use the right typeface for the right job — Fraunces is editorial display, not data display:',
  '',
  '- Headlines / display text → Fraunces (`var(--font-display)`), italic OK',
  '- Numerical data (KPIs, tables, charts) → DM Sans or JetBrains Mono with',
  "  `font-feature-settings: 'tnum'` for tabular alignment. Never italic.",
  '- Body / UI text → DM Sans (`var(--font-sans)`)',
  '- Code / file paths → JetBrains Mono',
  '',
  'For currency / large numerical KPIs ($4.81M), use sans-serif bold or mono medium —',
  'italic serif numbers visually collide and feel low-quality.',
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
  "- Logo: if the user asked for it to be *generated* / *illustrated* / *rendered* / any language implying a painted or photographic mark → `generate_image_asset` with `purpose='logo'`, `aspectRatio='1:1'`. Only fall back to inline SVG when the user clearly wants a flat geometric wordmark or when no logo was requested at all.",
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
  /**
   * Phase 2 — tools the agent can call. When set, overrides the built-in
   * default toolset (set_todos + text_editor when `fs` is provided). Pass
   * `[]` to explicitly run with zero tools (single-turn behaviour).
   */
  tools?: AgentTool<TSchema, unknown>[] | undefined;
  /**
   * Virtual filesystem callbacks for the text_editor tool. When provided,
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
   * console / load errors back to the agent. Without it, `done` falls back
   * to static lint only.
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
 * Route a generate() request through pi-agent-core's Agent with zero tools.
 *
 * Phase 1 invariant: produces the same artifact as generate() when called
 * with the same inputs. Events are emitted so Workstream C can subscribe to
 * a persistable stream, but the final GenerateOutput shape is identical.
 *
 * Not exposed through the IPC layer unless USE_AGENT_RUNTIME is truthy.
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
    input.apiKey,
  );
  log.info('[generate] step=resolve_model.ok', { ...ctx, ms: Date.now() - resolveStart });

  log.info('[generate] step=build_request', ctx);
  const buildStart = Date.now();
  const skillsBuiltinDir = input.templatesRoot
    ? path.join(input.templatesRoot, 'skills')
    : undefined;
  const skillResult = input.systemPrompt
    ? { blobs: [] as string[], warnings: [] as string[] }
    : await collectSkills(log, input.model.provider, skillsBuiltinDir);
  const systemPrompt =
    input.systemPrompt ??
    composeSystemPrompt({
      mode: 'create',
      userPrompt: input.prompt,
      ...(skillResult.blobs.length > 0 ? { skills: skillResult.blobs } : {}),
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
  //   - read_url        (always — uses global fetch)
  //   - read_design_system (always — closes over the caller's designSystem)
  //   - text_editor + list_files + done (when fs callbacks are provided)
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
  defaultTools.push(makeReadUrlTool() as unknown as AgentTool<TSchema, unknown>);
  defaultTools.push(
    makeReadDesignSystemTool(() => input.designSystem ?? null) as unknown as AgentTool<
      TSchema,
      unknown
    >,
  );
  if (deps.fs) {
    defaultTools.push(makeTextEditorTool(deps.fs) as unknown as AgentTool<TSchema, unknown>);
    defaultTools.push(makeListFilesTool(deps.fs) as unknown as AgentTool<TSchema, unknown>);
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
    skills: skillResult.blobs.length,
    skillWarnings: skillResult.warnings.length,
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
            return key && key.length > 0 ? key : input.apiKey || 'open-codesign-keyless';
          } catch (err) {
            capturedGetApiKeyError = err;
            throw err;
          }
        }
      : () => input.apiKey || 'open-codesign-keyless',
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
  // once the model has emitted tokens or tool calls, side effects (text_editor
  // writes, set_todos state) have already fired and a retry would re-run them.
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
  if (finalAssistant.stopReason === 'error' || finalAssistant.stopReason === 'aborted') {
    // Prefer the original `getApiKey` throw (e.g. PROVIDER_AUTH_MISSING after
    // mid-run logout) over pi-agent-core's flattened plain-string failure,
    // so the renderer's error-code routing stays consistent with the path
    // that would have fired if the same error had been raised at IPC entry.
    if (capturedGetApiKeyError !== null) {
      log.error('[generate] step=send_request.fail', {
        ...ctx,
        ms: Date.now() - sendStart,
        stopReason: finalAssistant.stopReason,
        reason: 'getApiKey_threw',
      });
      throw capturedGetApiKeyError;
    }
    const message = finalAssistant.errorMessage ?? 'Provider returned an error';
    log.error('[generate] step=send_request.fail', {
      ...ctx,
      ms: Date.now() - sendStart,
      stopReason: finalAssistant.stopReason,
    });
    throw remapProviderError(
      new CodesignError(message, ERROR_CODES.PROVIDER_ERROR),
      input.model.provider,
      input.wire,
    );
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

  const parser = createArtifactParser();
  const collected: Collected = { text: '', artifacts: [] };
  collect(parser.feed(fullText), collected);
  collect(parser.flush(), collected);

  if (collected.artifacts.length === 0) {
    // Prose `<artifact>` fallback (fenced ```html / bare <html>) was deliberately
    // removed: the agent owns artifacts via the text_editor tool, and tolerating
    // inline source encouraged the model to double-emit (tool + prose), spamming
    // the user's chat view. The fs path below is the only supported recovery
    // when the parser produced nothing.
  }

  // When the agent used the text_editor tool to write index.html, the final
  // assistant text is just prose. Pull the artifact out of the virtual FS.
  if (collected.artifacts.length === 0 && deps.fs) {
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
  return skillResult.warnings.length > 0
    ? { ...output, warnings: [...(output.warnings ?? []), ...skillResult.warnings] }
    : output;
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
