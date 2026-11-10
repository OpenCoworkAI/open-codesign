# @open-codesign/core

## 0.3.0

### Minor Changes

- c9757a0: Add opt-in OpenAI Responses and Claude hosted web search through pi, preserving citations, sources and continuation data while accounting for native requests separately from local search and fetch calls.
- 5f6036b: Add opt-in Tavily web search and bounded public-page reading through native agent tools. Persist workspace sources, evidence and stable slide usage, and generate independent Markdown companions in ordinary exports without adding citations to slides by default.

### Patch Changes

- 1d33526: Add a Node CLI for safe diagnostics, read-only workspace inspection and HTML export without
  Electron. Share desktop workspace readers and design classification through core subpaths,
  and prevent HTML asset inlining from following symlinks outside the workspace.
- c3d2ff3: Add Atlas Cloud as a built-in OpenAI-compatible provider for onboarding, validation, model discovery, and provider selection.
- 89fe5cd: Preserve ChatGPT subscription model selections on upgrade and re-login. Suggest models from local Codex configuration and pi's maintained catalog, require an editable initial selection, and keep upstream model-access errors with recovery guidance.
- 029128d: Fit each generation run into the model's context window. Before the request, the system prompt, tool definitions and the prompt are measured in tokens, and a quarter of the window (at most the 32,000 tokens a run requests) stays free for the reply; the request asks for no more output than that, so models with a window under 128k tokens request less than 32,000. If those parts do not fit, the run stops with an error that names the window and points to the context window setting in Settings → Models, instead of sending a request the model would truncate. Chat history keeps its newest messages that fit what remains.
- a63feb5: Accept zero and leading-dot CSS dimensions in DESIGN.md, and preserve unknown top-level metadata with non-blocking warnings. Improve repair guidance for misplaced font families while keeping malformed token structures, nonzero unitless dimensions, and runtime failures blocking.
- 761b3b8: Prepare the design-token import. Core exports `mapTokensToDesignFields`, which turns scanned tokens into DESIGN.md colors, typography, rounded and spacing fields, with font sizes, line heights and shadows as Markdown sections. It converts `rgb()`, `hsl()` and `oklch()` colors to sRGB hex (a clamped out-of-gamut color is reported with its original value), replaces `var()` with the scanned token it names, leaves other `[data-theme]` values out, and returns what it could not map instead of logging it. Shared exports `serializeDesignMd`. Tailwind v4 `--font-*` variables are now read as font families, and a CSS variable declared in a `[data-theme]` block records that block.
- e94c3c1: Export all pages of decks that mount one slide at a time behind numbered navigation, and keep ordinary table borders editable on each side of a cell. Preserve explicit chart colors, legend visibility, value labels and doughnut holes, retain horizontal category order, and respect suppressed CSS list markers.

  Ask generated slide charts to retain the matching style metadata by default.

- e94c3c1: Keep basic SVG slide charts editable as native shapes, lines, and text instead
  of rasterizing every unmarked SVG. Preserve viewBox scale, label colors, bar
  corners, and threshold lines; warn when chart data series are unavailable.
  Support horizontal native bar chart metadata and request chart data in the
  general slide and research generation guidance.
- f35b854: Apply Settings → Advanced → Generation timeout to each model HTTP request as well as the overall run, so long turns against local LM Studio / Ollama / vLLM endpoints are no longer cut off by the provider SDK's 10-minute default.
- b0a9ee1: Check layout and accessibility in `preview` and `done`. After a page loads, a deterministic measurement looks for a page that scrolls sideways, text that its box clips, text with too little contrast (WCAG AA, 4.5:1, or 3:1 for large text), tap targets under 24 by 24 px that have another target next to them, and controls with no accessible name. It measures at the current width and again at a 390 px phone width. `preview` lists up to 20 findings in `layoutIssues`; `done` shows them under "Non-blocking warnings", and when one is present it lets the agent fix it and check it with `preview` instead of telling it to stop. Findings never change `ok` or the `done` status, so a false positive cannot cost a repair round. `done:verify:v1` now returns `warnings` and a `schemaVersion` next to `errors`.
- c9757a0: Stop pending Claude search continuations at the authorized request budget and avoid replaying ambiguous native search history when assistant replies repeat.
- 03dea98: Switch multi-page prototypes inside one preview document. Matching `id` and `data-oc-screen` values identify each screen, `#id` links select one screen, and shared chrome stays visible. Inactive screens use the `hidden` attribute so their own layout remains intact.
- 856dba8: Use each model's real context window. A generation run takes the window from a new per-provider "Context window" setting in Settings → Models, then from pi-ai's model catalog, and falls back to 200k tokens only when neither knows the model. Set it for local runtimes such as Ollama or LM Studio and for relays the catalog does not know. The chat history sent with each run follows the resolved window.
- 5f6036b: Only inject research workflow guidance when its tools are available to the model. Keep ordinary primary exports successful when optional source companions fail, surfacing warnings instead; explicit source exports still report errors. Make research record reads side-effect-free without creating directories/files or rewriting saved metadata.
- 466e64d: Stop a run that keeps repeating the same tool call. When the model makes the same call with identical arguments three times in a row, or repeats the same short sequence of calls three times, the call is blocked and the model reads a reason telling it to change approach. At five repeats the run ends with the incomplete-generation error, no further tool or model request runs, and the workspace files are kept. A call with different arguments starts the count again, `done` keeps its own repair limit, and there is no cap on how many times a tool is called in total.
- Updated dependencies [c3d2ff3]
- Updated dependencies [029128d]
- Updated dependencies [0d3d63e]
- Updated dependencies [a63feb5]
- Updated dependencies [761b3b8]
- Updated dependencies [3b03e7a]
- Updated dependencies [f35b854]
- Updated dependencies [e24d1f1]
- Updated dependencies [24815f3]
- Updated dependencies [6799d55]
- Updated dependencies [c9757a0]
- Updated dependencies [c9757a0]
- Updated dependencies [9574745]
- Updated dependencies [e331e69]
- Updated dependencies [856dba8]
- Updated dependencies [ec7f76d]
- Updated dependencies [b7a0090]
- Updated dependencies [c9757a0]
- Updated dependencies [719d089]
- Updated dependencies [143cf96]
- Updated dependencies [4cf3393]
- Updated dependencies [787a8e4]
- Updated dependencies [09f21c3]
- Updated dependencies [5f6036b]
  - @open-codesign/shared@0.3.0
  - @open-codesign/providers@0.3.0

## 0.2.2

### Patch Changes

- 8303e2b: Remove the desktop's automatic router questionnaire before generation. Route capability preferences without an interview, act on reversible design choices, and retain the agent's structured ask bridge for genuine blockers and explicit interview requests. Permission gates and paid-action authorization are unchanged.

  Reuse validated, matching answers from existing session tool results as labelled data within the existing context budget. Preserve conversation and brief priority; do not infer answers from cancelled, empty, malformed, or historical count-only results. Keep legacy clarification helpers compatible without using them as the live generation path.

- cd39c0c: Add optional viewport and bounded click, fill, keyboard, and assertion steps to preview. Report ordered interaction evidence and the final visible screen so connected products can verify shared state and navigation before completion. Existing render-only calls remain supported; checks run in an isolated disposable browser and do not promise persistence or coverage of untested flows.
- eff688b: Preserve delivered active instructions, their identity, and completed tool results during transport and reasoning recovery. Continue the interrupted pi transcript without replaying the original prompt or duplicating delivery.
- c9d7e20: Guide app generation toward bounded connected local prototypes with shared data, working navigation and back paths, relevant form states, and readable JSX. Preserve single-screen, document, deck, and narrow revision scope; clarify simulated services and sandbox persistence limits. Align built-in method skills with behavior-focused preview checks and concrete repairs instead of automatic polish quotas.
- 619d7af: Guide tweak declarations toward consequential, implemented design choices with source-matched defaults, shared bindings, constrained options, and preserved user selections. Add method guidance for checking alternate rendered values and restoring defaults without claiming artifact previews test the host tweak panel or automatically synchronize unbound files. Keep targeted tweak edits narrow and avoid delaying the first working frame.
- 729e356: Coordinate participating workspace writers by canonical file path across designs.
  Conditional saves and agent text edits compare expected disk bytes inside the
  writer queue; stale agent edits fail visibly and refresh the file view for an
  explicit retry. External processes remain outside the in-process atomicity boundary.
- 631143d: Add **Decompose to UI Kit** — opt-in sidebar action that emits a `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}` bundle shaped for downstream coding-agent handoff (Claude Code, Cursor). Decomposition is prompt-driven (no AST/parser deps); the orchestrator persists the structured plan to the virtual fs in a single atomic call. Output carries `schemaVersion: 1` so downstream consumers can evolve safely.

  Three new agent tools in `packages/core/src/tools/`:

  - `decompose_to_ui_kit` — orchestrator. Emits the full bundle from a source image + design brief.
  - `verify_ui_kit_parity` — deterministic verifier (no LLM, no cost): element-count parity, visible-text coverage, token coverage. Returns `passCount/totalChecks` derived score (no fabricated floats).
  - `verify_ui_kit_visual_parity` — vision-LLM judge wrapper. 12-check boolean rubric across 5 dimensions (layout / color / typography / content / components), anchor-calibrated reasoning-then-score chain-of-thought (WebDevJudge / Prometheus-Vision / Trust-but-Verify ICCV 2025). Host injects `renderUiKit` (headless screenshot) and `judgeVisualParity` (multimodal call) via the same deps interface as `generate_image_asset`. Without injections the tool returns `status: "unavailable"` and the agent proceeds with the deterministic verifier alone.

  `decomposePrompt.ts` (EN + ZH) walks the agent through decompose → verify (both) → reconcile gaps → iterate (max 2) → done with HONEST cost summary. Per-decompose cost surfaces inline as a toast.

  Refs #225 (Phase 1 of the requested image → componentization → prototype workflow). Phase 2 (cross-page flows, state machines, prototype orchestration) is tracked separately.

- f2a9dbb: Preserve string-valued DESIGN.md component extensions with warnings, as required by Google's alpha consumer specification, rather than failing an otherwise working artifact. Keep malformed token values and runtime failures blocking and provide concrete object-shape repair guidance.

  Surface non-blocking metadata warnings in done results and preserve error/warning counts through repeated stream/history compaction. Update the design-system method's portability guidance without silently rewriting user tokens or changing the repair limit.

- a9609e6: Pass optional source-path context to runtime verification and resolve local assets against the latest bound workspace under the workspace path lock. Preview and done share safe file access and source-relative base URLs, including nested source files. Missing or out-of-workspace assets still fail and now identify the requested resource URL.
- 0db17ee: Use supported default reasoning for GPT-6 Astra, including custom Responses gateways and helper requests. Preserve locally submitted generation state until its IPC response arrives so early stream completion cannot hide errors, artifacts, or token usage.
- d199c75: Queue text follow-ups or steer the next safe processing step during generation using pi's native message queues. Preserve per-design drafts, delivery receipts, and recoverable undelivered messages in local session JSONL without bypassing permission or question gates.
- b2d020d: Forward image attachments through OpenAI-compatible and Anthropic-style provider paths instead of only marking Codex synthesized models as image-capable.
- f2758a6: Rewrite shared design prompts and seven on-demand methods around requested outcomes, coherent early slices, preserved journeys and focus, brief-grounded visual choices, and observed completion. Remove duplicated host procedures, rigid aesthetic quotas, and contradictory inferred-tweak prohibitions while retaining runtime, permission, source-format, brand, and data boundaries.

  Add mode/provenance/feature-profile budget contracts and validate the method's DESIGN.md example against the actual schema. Document official prompting sources and the limits of prompt-only validation. Existing local method copies require a separate ownership-preserving upgrade; this change does not overwrite user templates or alter model/provider settings.

- 2d95f7f: Add a bounded preview select action for native single-selection dropdowns. Select options by exact value using browser input/change events, with explicit errors for disabled controls/options, unsupported multiple selects, and missing or ambiguous targets. Keep existing step budgets and keyboard restrictions.
- c9a512b: Clarify preview's existing 16-step hard limit in both the tool and steps schema descriptions, including counting assertions and retrying rejected arguments. Guide independent short journeys with fresh setup rather than assuming state continues between calls. Retain existing execution and time bounds.
- f0d675c: Guide substantial fresh app generation through a few valid, renderable milestones: an early coherent frame, connected journeys, and integrated craft and responsive refinement. Allow early frame previews without confusing them with full behavior verification, require syntactically complete source after each edit, and preserve the final requested scope without mandatory extra rounds.
- 8d4590a: Clarify that an early app checkpoint precedes secondary-screen implementation and full styling. Guide navigation revisions to preserve access to core record actions and return/recovery paths from newly reachable screens, checking changed entry paths instead of relying on old-screen checks or repeating every cosmetic check. These prompt contracts do not guarantee model compliance or fix runtime routing.
- e70430d: Recover a truncated design-session brief with one bounded larger-output retry, retaining the previous brief on failure and including reported usage from the truncated attempt. Keep length-stop errors typed without accepting partial completion content.
- 729e356: Keep generation ownership until cancellation and cleanup settle. Bind clarification,
  preview, verification, and workspace publication to cancellation; prevent cancelled
  prompt/recovery admissions and preserve queued messages for explicit recovery.

  Use pi's sequential ask barrier and reject remaining tools when the third failed
  done check exhausts repair attempts. Report incomplete verification without another
  provider turn or misclassifying the repair limit as a user cancellation.

- 573546f: Report unresolved final design verification as GENERATION_INCOMPLETE, including repair-limit exhaustion and remaining verifier details, rather than returning an apparently successful result. Keep generated workspace files and session history available for inspection and retry.
- ef5677c: Explain missing, empty, or invalid tweak declarations for the active preview
  source instead of promising automatic controls. Surface malformed declarations
  without crashing the panel. Clarify that the tweaks scanner only discovers
  declarations: unrelated starter values are not controls for the active preview.
- fb92207: Give run-preference preflight a bounded inventory of existing workspace files and recognize workspace DESIGN.md as design guidance. Document-only demo inputs no longer look like missing references just because App.jsx has not been generated. Inventory omissions remain unknown, not proof of missing files; substantive clarification stays available.
- Updated dependencies [729e356]
- Updated dependencies [f2a9dbb]
- Updated dependencies [0db17ee]
- Updated dependencies [d199c75]
- Updated dependencies [b2d020d]
- Updated dependencies [a3a08e6]
- Updated dependencies [e70430d]
- Updated dependencies [729e356]
- Updated dependencies [ef5677c]
- Updated dependencies [729e356]
  - @open-codesign/shared@0.2.2
  - @open-codesign/providers@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [7a1977d]
- Updated dependencies [6cbb639]
- Updated dependencies [7a1977d]
  - @open-codesign/providers@0.2.1
  - @open-codesign/shared@0.3.0

## 0.2.0

### Minor Changes

- 4391788: feat(codex): unify ChatGPT subscription path onto pi-ai's built-in openai-codex-responses wire

  Phase 2 of the Codex subscription login work. The self-rolled Codex client
  path from Phase 1 is replaced by pi-ai's first-class `openai-codex-responses`
  adapter (shipped in pi-ai 0.67.68) so every provider — Anthropic, OpenAI,
  Gemini, ChatGPT Codex — now runs through the same core/pi-agent-core route
  with no provider-specific branching.

  ### Schema + routing

  - `packages/shared`: extend `WireApiSchema` and `CanonicalWire` with
    `openai-codex-responses`; promote `CHATGPT_CODEX_PROVIDER_ID` to shared so
    `provider-settings` references the same literal the OAuth module writes
    without creating a module cycle.
  - `canonicalBaseUrl` passes codex URLs through untouched (pi-ai's wire
    appends `/codex/responses` itself); `modelsEndpointUrl` throws for codex
    (no discoverable /models endpoint — providers use `modelsHint`).
  - `packages/core`, `packages/providers`: `apiForWire` + `synthesizeWireModel`
    recognize the new wire; all 4 duplicated `'openai-chat' | …` unions
    consolidated onto the shared `WireApi` type.

  ### Desktop wiring

  - New `apps/desktop/src/main/resolve-api-key.ts`: dependency-injected helper
    that routes ChatGPT provider id to the token store's auto-refreshing
    access token, and every other provider to the keychain-backed API key.
    Codex auth failures surface as `CodesignError(PROVIDER_AUTH_MISSING)` so
    the renderer's error-code routing stays consistent with the API-key-missing
    path. Covered by 7 unit tests via DI.
  - `main/index.ts`: `resolveActiveApiKeyFromState` replaces the inline
    `isChatgptCodex` validate / dispatch branches in all 4 IPC handlers
    (`codesign:v1:generate`, legacy `codesign:generate`, apply-comment,
    generate-title). Legacy `codesign:generate` no longer rejects codex.
  - Long-running agent runs: `GenerateInput.getApiKey` is a new optional async
    getter; the desktop passes it only for codex so pi-agent-core calls back
    into the token store on each LLM round-trip (auto-refreshes within the
    5-min buffer). Mid-run sign-out errors are captured in a closure variable
    and rethrown verbatim from the post-agent branch so the structured
    `PROVIDER_AUTH_MISSING` code isn't lost to pi-agent-core's plain-string
    failure-message flattening.

  ### Registration + migration

  - `codex-oauth-ipc.ts`: provider entry registers `wire=openai-codex-responses`,
    bare `baseUrl=https://chatgpt.com/backend-api`, and the full 9-model catalog
    (gpt-5.1 → gpt-5.4-mini), ordered flagship-first.
  - `migrateStaleCodexEntryIfNeeded()` runs once at boot and rewrites any
    Phase-1-shaped `chatgpt-codex` provider (`wire=openai-responses`,
    `baseUrl=/codex`) to the Phase 2 canonical values, so feat-branch testers
    don't need to sign out and back in after upgrade. No-op when the entry is
    absent or already canonical.

  ### UI

  - `ChatgptLoginCard.tsx`: flipped out of "coming soon" mode back to the full
    three-state login/status/logout flow, with i18n keys in both locales.

  ### Deletions (-963 LOC of Phase 1 code now provided by pi-ai)

  - `apps/desktop/src/main/codex-generate.ts` + test
  - `apps/desktop/src/main/codex-title.ts`
  - `packages/providers/src/codex/client.ts` + test

  OAuth-side code (`oauth.ts`, `oauth-server.ts`, `token-store.ts`) is unchanged
  — still the only codex-specific code, and it sits outside the generation link.

- a5f1cc0: feat: structured logging foundation

  - Every workspace package now logs through an injected `CoreLogger` instead of `console.*` — renderer and workspace signals both reach `main.log`.
  - Renderer `console.*` bridge preserves object structure (no more `[object Object]`) with an 8 KB per-arg size cap.
  - `runId` from `AsyncLocalStorage` auto-attaches to every log line inside a generation handler; IPC payloads unchanged.
  - Log file retention extended to 3 × 5 MB (`main.log` / `main.old.log` / `main.old.1.log`); rotation is resilient to Windows EBUSY / TOCTOU.
  - Legacy settings IPC deprecation warnings are deduped via `warnOnce` — first occurrence logs once, repeats are suppressed.
  - Biome enforces `no-console` in main / core / providers / exporters / shared.
  - `generationId` schema tightened to alphanumeric + `_`/`-`, max 128 chars (defense in depth for log-line injection).

  Breaking for out-of-tree consumers implementing `CoreLogger`: the interface now requires a `warn` method alongside `info` / `error`.

- 4c66392: # v0.2.0 — Agent Loop & Harness

  v0.2 swaps the bespoke pi-agent-core integration for the richer
  `@mariozechner/pi-coding-agent` SDK and rebuilds the agent harness
  around it. This is the largest internal change since v0.1.0 was cut.

  ## Highlights

  - **pi-coding-agent (0.69.0) integration.** A new
    `createCodesignSession()` boundary owns session creation, the bash
    permission hook, model registry, and resource-loader extension
    factories. Legacy `generate()` flow is left intact for backwards
    compat — consumers migrate incrementally.
  - **JSONL session storage.** Designs are now `SessionManager`-managed
    JSONL files under `<userData>/sessions/`. The old SQLite tables for
    `snapshots` / `chat_messages` / `comments` are deleted.
  - **Bash permission gating.** `tool_call` extension hook gates every
    bash invocation; renderer surfaces a 3-button modal (Deny / Allow
    once / Always allow). A hard-coded blocklist refuses
    `rm -rf /`, `sudo`, `curl ... | sh`, and `npm/pnpm/yarn/cargo
publish` without ever escalating to the user.
  - **Workspace FSWatcher.** `node:fs.watch` (recursive) drives a
    per-design `fs:event` channel — external editors (VSCode, etc.)
    hot-reload the preview tab without going through the agent.
  - **Brand acquisition + multi-screen baton.** Two new system-prompt
    sections enforce sourcing brand colors from real CSS (never from
    memory) and propagating tokens through a workspace `DESIGN.md` so
    multi-screen projects stay visually consistent.
  - **Built-in catalogues.**
    - 30 scaffold starters (device frames, browser chrome, dev mockups,
      UI primitives, backgrounds, decks, landing).
    - 5 new P0 design skills (`form-layout`, `empty-states`,
      `loading-skeleton`, `surface-elevation`, `cjk-typography`) on top
      of the existing 4 builtins.
    - 25 brand DESIGN.md references (vercel, linear, stripe, figma,
      notion, apple, airbnb, spotify, cursor, supabase, posthog,
      framer, runwayml, mistral, elevenlabs, coinbase, revolut, nike,
      ferrari, spacex, starbucks, shopify, ibm, raycast, cal-com).
  - **v0.1 → v0.2 migration.** First-launch detector pops a dialog when
    it finds an old `designs.db`, materialises each design into its own
    workspace, replays chat into a JSONL session, and renames the
    source DB to `designs.db.v0.1.backup`. Per-design failures are
    surfaced and the rest of the migration continues.
  - **Background process registry.** Tab-model lifecycle for dev
    servers — SIGTERM (3 s) → SIGKILL on tab close, ≤3 procs/design,
    ≤10 global, port auto-detected from stdout.
  - **Capability-driven tool exposure.** `gen_image` only appears when
    an OpenAI provider is configured; `preview` returns screenshots
    only for vision-capable models.

  ## Deprecations / breaking

  - **Removed**: `snapshots-ipc`, `chat-messages-ipc`, `comments-ipc`
    IPC channels. Renderer-side consumers were stubbed; v0.2.x will
    reroute them through the session JSONL.
  - **Renamed**: `apps/desktop/src/main/snapshots-db.ts` →
    `designs-db.ts` (its only remaining job is `diagnostic_events`).
  - **Pinned**: `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core`
    upgraded from `^0.67.68` to `^0.69.0`. New dep:
    `@mariozechner/pi-coding-agent ^0.69.0`.

  ## Migration

  First launch on v0.2 with a v0.1 install: a dialog will appear asking
  to migrate. Choose yes; the source DB stays as `designs.db.v0.1.backup`
  in `<userData>` so you can manually inspect anything that didn't make
  it across.

  ## Known limitations

  - The new tools (`ask`, `scaffold`, `skill`, `preview`, `tweaks`) ship
    with their wire-format contracts and unit-tested logic, but the
    end-to-end glue (renderer modals, sandbox iframe round-trip) lands
    in a v0.2.x patch series — see `docs/v0.2-final-report.md`.
  - `T5.3` Playwright E2E and `T5.4` migration fixture suites are
    scaffolded as TODOs; current coverage is via in-process vitest
    cases against the migration helper.
  - Pre-existing lint debt (`Settings.tsx` cognitive complexity, a
    handful of `text-[10px]` literals outside FilesPanel/FilesTabView)
    is tracked separately.

### Patch Changes

- 63fa316: Fix: retry first-turn agent generation on transient provider errors (5xx, 429, network). The agent runtime now wraps `agent.prompt()` + `waitForIdle()` in a backoff loop for the first turn only — multi-turn requests still fail fast to avoid corrupting mid-session tool state. Extracted a generic `withBackoff` helper in `@open-codesign/providers` that shares the existing classify/jitter/Retry-After/abort logic with `completeWithRetry`. (#125)
- 0d4c5cf: Clean aborted transport retry history before replaying an agent turn, and keep HTML/ZIP exports offline by default by making Tailwind CDN injection opt-in for saved HTML bundles.
- 4c66392: Harden HTML, URL, marker, stack-frame, and retry parsing paths flagged by CodeQL during the v0.2 mainline promotion.
- a965e58: fix: send attached screenshots to ChatGPT Codex as image inputs

  Image attachments in the desktop app were previously reduced to filename-only hints on the `chatgpt-codex` route, so models like `gpt-5.4` could ignore uploaded screenshots entirely.

  This change keeps the existing text-attachment behavior, but reads supported image files into data URLs and forwards them as Responses `input_image` parts for ChatGPT Codex generations.

- bc7b311: Use conservative OpenAI Chat compatibility settings for DeepInfra endpoints to avoid unsupported OpenAI extension fields during generation.
- 4e0c40c: Cap repeated `done()` error rounds so verification loops stop after three failed checks.
- 4c66392: refactor: make create prompts manifest-first

  - Replace keyword-routed create prompt composition with deterministic base sections plus resource manifest summaries.
  - Move heavyweight guidance into lazy-loaded skills and remove stale single-shot artifact prompt exports.
  - Remove full skill body injection helpers and demote old tool names in the chat working-card UI.
  - Add artifact composition, chart rendering, and craft polish skill manifests for explicit progressive disclosure.

- 013fd34: feat: normalize provider errors into structured log events

  - `normalizeProviderError(err, provider, retryCount)` produces a flat `NormalizedProviderError` object capturing `upstream_status`, `upstream_code`, `upstream_request_id`, `retry_count`, and the first 512 bytes of the response body with API keys / bearer tokens redacted.
  - `completeWithRetry` emits `provider.error` on each retried attempt and `provider.error.final` when retries are exhausted, via an injected logger. The `runId` set by PR1's `AsyncLocalStorage` automatically joins every event.
  - New `PROVIDER_UPSTREAM_ERROR` code in the shared registry for errors that reach the final throw without a more specific classification.
  - Net effect: triaging a user-reported 4xx/5xx now works from the log alone — no follow-up request needed for `request-id` or response body.

  Also includes two PR1 follow-ups: corrects two misplaced `biome-ignore` comments (`ChatMessageList.tsx`, `chat-ui.jsx`) and makes `logger.rotation.test.ts` path-separator portable for future Windows CI.

- 075ff22: Retry agent turns with reasoning disabled when an OpenAI-compatible endpoint rejects missing `reasoning_content`.
- 4c66392: fix: align build, tool prompts, and model switcher token output

  - Keep root and desktop builds on the fast Vite compilation path, with installer packaging available through explicit package/release scripts.
  - Bundle local `@open-codesign/*` workspace packages into the desktop main bundle so electron-builder only packages true runtime externals.
  - Prune packaged dependency noise such as source maps, declaration files, tests, examples, unused Electron languages, and non-target native binaries from the desktop app bundle.
  - Fail packaging when the target better-sqlite3 Electron native binary is missing, instead of shipping an app that crashes on database open.
  - Merge newly bundled template files into existing user template folders without overwriting user edits, so manifest-first skills are available after upgrades.
  - Route v0.1 database migration through the same better-sqlite3 native binding resolver used by the app database, so package pruning does not break migration.
  - Materialize legacy assistant chat rows as valid pi session messages during v0.1 to v0.2 migration.
  - Pin the `@xmldom/xmldom` security override to `0.8.13` to avoid electron-builder plist parsing failures from `0.9.x`.
  - Remove a redundant dynamic import that made Vite warn during the desktop main build.
  - Align agent-facing edit instructions with the real `str_replace_based_edit_tool` command payload and remove unused legacy helper tool factories from core.
  - Treat `view_range` `-1` bounds as EOF so ranged views cannot bypass the full-file view budget.
  - Keep model-facing `view_range` guidance consistent with the EOF behavior and add desktop package metadata used by electron-builder.
  - Wrap selected artifact DOM snippets, reference URL excerpts, and local attachment text as escaped untrusted context, injected once at the agent boundary.
  - Escape untrusted-context wrapper metadata and restrict reference URL prefetching, including redirects, to non-credentialed HTTP(S) URLs.
  - Reject reference URL hosts that are localhost, private/link-local/reserved IPs, or resolve through DNS to blocked addresses before fetching any content.
  - Apply the Reference URL timeout to DNS resolution as well as fetch, so a stuck resolver cannot hang generation before the HTTP request starts.
  - Use a Node HTTP(S) fetcher with a guarded connection-time DNS lookup so a host cannot pass preflight DNS validation and then rebind to a blocked address during the actual request.
  - Reject empty or relative workspace paths at bind/update time and revalidate stored workspace paths before filesystem reads or writes, so corrupt bindings cannot silently write relative to the app cwd.
  - Require workspace paths to be absolute for the current platform, so Windows drive paths are not treated as cwd-relative folders on macOS/Linux, and Windows normalization stays fully qualified.
  - Make `codesign:files:v1:list` fail fast for missing designs, unbound workspaces, and corrupt stored workspace paths instead of reporting an empty directory.
  - Make workspace file watcher subscriptions fail fast with typed IPC errors, validate stored workspace paths before watching, and restart the watcher when a design is rebound to a different workspace.
  - Make the renderer file-list hook track the current workspace binding, skip workspace IPC calls when no workspace is bound, and surface watcher subscription failures instead of silently ignoring them.
  - Create and duplicate designs with an atomic workspace binding step, hiding failed rows instead of returning workspace-less designs.
  - Roll back failed create/duplicate workspace allocation by deleting only auto-created workspace directories and hard-deleting incomplete DB rows so cloned snapshots/files do not linger behind a hidden design.
  - Revalidate stored workspace paths before generation and session JSONL access, so corrupt bindings cannot become a generation cwd.
  - Require workspace binding targets to be real directories and surface missing/non-directory selections as input errors.
  - Reject product-level attempts to clear a design workspace, while keeping low-level nullable schema behavior only for legacy/migration compatibility.
  - Copy tracked workspace files and `design_files` mirrors when duplicating a design, and reject workspace-less legacy sources before cloning.
  - Require `designId` and a bound workspace for generation so agent runs cannot succeed without a real design workspace.
  - Remove the old chat-session `defaultCwd` fallback and reject unbound legacy designs at chat/runtime filesystem boundaries.
  - Add localized `WORKSPACE_MISSING` copy and update null-workspace UI text to describe the legacy unbound state explicitly.
  - Reject workspace reads, writes, runtime write-through, and tracked-file copies that traverse symlinked path segments inside the workspace.
  - Reject symlink traversal in scaffold writes, skill/brand-reference loads, frame/design-skill template loads, project-context reads, preview source reads, and preview `file://` asset requests.
  - Restore the done-runtime load-error formatter contract and redact self-contained data URLs so verifier failures do not dump large srcdoc payloads.
  - Surface workspace file-list IPC failures in the renderer instead of silently rendering an empty file list.
  - Fail fast on incomplete `str_replace_based_edit_tool` command payloads instead of silently defaulting missing edit fields, and reject `insert` against missing files.
  - Keep the skill loader genuinely lazy by removing top-level runtime re-exports and dynamically importing it from the `skill` tool only when a manifest is requested.
  - Add missing localized copy for `GENERATION_INCOMPLETE` so every shared error code has user-facing text.
  - Preserve v0.1 inline comments during migration, close the legacy database before backup rename, allocate a unique backup name when an older backup exists, and validate legacy file paths before creating workspace directories.
  - Make better-sqlite3 native binding resolution fail fast instead of falling back from Electron to the default Node ABI binary.
  - Add hyphenated spacing token aliases so Tailwind arbitrary `calc()` values emit valid CSS.

- Updated dependencies [63fa316]
- Updated dependencies [4cec7ea]
- Updated dependencies [4391788]
- Updated dependencies [95412b9]
- Updated dependencies [4c66392]
- Updated dependencies [0a0ff2e]
- Updated dependencies [bc7b311]
- Updated dependencies [19b2909]
- Updated dependencies [6c3a908]
- Updated dependencies [a799cab]
- Updated dependencies [b7ab2c8]
- Updated dependencies [418e5a8]
- Updated dependencies [022e1b6]
- Updated dependencies [441e7c7]
- Updated dependencies [e622d62]
- Updated dependencies [d815de5]
- Updated dependencies [a5f1cc0]
- Updated dependencies [b2a6d15]
- Updated dependencies [4c66392]
- Updated dependencies [09f976a]
- Updated dependencies [013fd34]
- Updated dependencies [d3a62fe]
  - @open-codesign/providers@0.2.0
  - @open-codesign/shared@0.2.0
