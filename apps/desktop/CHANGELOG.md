# @open-codesign/desktop

## 0.2.2

### Patch Changes

- 8303e2b: Remove the desktop's automatic router questionnaire before generation. Route capability preferences without an interview, act on reversible design choices, and retain the agent's structured ask bridge for genuine blockers and explicit interview requests. Permission gates and paid-action authorization are unchanged.

  Reuse validated, matching answers from existing session tool results as labelled data within the existing context budget. Preserve conversation and brief priority; do not infer answers from cancelled, empty, malformed, or historical count-only results. Keep legacy clarification helpers compatible without using them as the live generation path.

- a77bb4a: Add three original local-input demo packs, localized feature tags and inspectable
  file lists to Examples. Seed references lazily into a fresh workspace before
  prefilling the prompt, without overwriting existing files or automatically
  submitting a generation.
- f44ef6b: Avoid appending a duplicate final assistant summary when a generation finishes after switching to another design.
- c8a179f: Show concise tool and generation errors with expandable, scrollable original
  diagnostics instead of flooding the conversation with raw validation arguments.
- cd39c0c: Add optional viewport and bounded click, fill, keyboard, and assertion steps to preview. Report ordered interaction evidence and the final visible screen so connected products can verify shared state and navigation before completion. Existing render-only calls remain supported; checks run in an isolated disposable browser and do not promise persistence or coverage of untested flows.
- 729e356: Allow text-only queue and steer messages during reference-URL and comment-application runs without resending their original context. Preserve delivered chat messages, initial history, and local tool updates when chat reads finish out of order or designs are switched.
- d1fbb08: Bind tweak controls to the file being previewed, including secondary JSX/HTML files. Refresh controls after source edits, preserve unrelated token changes, and reject stale or out-of-range writes instead of overwriting later revisions. Cancel pending saves when their design changes or generation starts.
- 729e356: Dismiss host-cancelled clarification requests without answering them or disturbing unrelated questions and drafts, including cancellations that race initial pending-question replay.
- 760147c: Let the conversation sidebar collapse to a narrow, keyboard-accessible restore
  rail. Keep chat and preview components mounted so drafts, active generation,
  scroll position, and artifact interaction state survive collapse and expansion.
  Preserve the previous sidebar width and hide the rail in fullscreen preview.
  New clarification requests reveal the conversation, while Escape cannot
  silently cancel a hidden question or cancel during IME composition.
- e140ea8: Keep the floating comments list below the actual preview header so wrapped toolbars
  and fullscreen exit controls remain accessible at larger interface zoom levels.
  Clamp the list to the remaining viewport height while preserving comment drafts.
- c8a179f: Keep the running composer compact with short queue/steer labels and an on-demand,
  keyboard-accessible delivery explanation. Preserve 40px action targets and fix
  ambiguous text-size utilities that caused inherited typography in the composer.
  Do not show additional-message actions for an empty draft after normal submission.
- 67afb24: Reduce desktop chrome with a compact single-row workspace header and a shared workspace-path/preview summary row. Keep narrow layouts, full model and design identification, diagnostics, native dragging, and expandable preview configuration accessible without reducing control targets.
- c9d7e20: Guide app generation toward bounded connected local prototypes with shared data, working navigation and back paths, relevant form states, and readable JSX. Preserve single-screen, document, deck, and narrow revision scope; clarify simulated services and sandbox persistence limits. Align built-in method skills with behavior-focused preview checks and concrete repairs instead of automatic polish quotas.
- 619d7af: Guide tweak declarations toward consequential, implemented design choices with source-matched defaults, shared bindings, constrained options, and preserved user selections. Add method guidance for checking alternate rendered values and restoring defaults without claiming artifact previews test the host tweak panel or automatically synchronize unbound files. Keep targeted tweak edits narrow and avoid delaying the first working frame.
- 729e356: Coordinate participating workspace writers by canonical file path across designs.
  Conditional saves and agent text edits compare expected disk bytes inside the
  writer queue; stale agent edits fail visibly and refresh the file view for an
  explicit retry. External processes remain outside the in-process atomicity boundary.
- 96cd16f: Include workspace CSV files in the existing bounded agent text-filesystem hydration. Seeded schedules and other local CSV references remain readable by the agent instead of appearing in the Files inventory but failing with "Path not found."
- 626fa14: Clear obsolete runtime errors when the visible preview document changes, while
  retaining errors from the current document. Background pooled previews no longer
  affect this reset, and file-preview error listeners attach before rendering.
- 631143d: Add **Decompose to UI Kit** — opt-in sidebar action that emits a `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}` bundle shaped for downstream coding-agent handoff (Claude Code, Cursor). Decomposition is prompt-driven (no AST/parser deps); the orchestrator persists the structured plan to the virtual fs in a single atomic call. Output carries `schemaVersion: 1` so downstream consumers can evolve safely.

  Three new agent tools in `packages/core/src/tools/`:

  - `decompose_to_ui_kit` — orchestrator. Emits the full bundle from a source image + design brief.
  - `verify_ui_kit_parity` — deterministic verifier (no LLM, no cost): element-count parity, visible-text coverage, token coverage. Returns `passCount/totalChecks` derived score (no fabricated floats).
  - `verify_ui_kit_visual_parity` — vision-LLM judge wrapper. 12-check boolean rubric across 5 dimensions (layout / color / typography / content / components), anchor-calibrated reasoning-then-score chain-of-thought (WebDevJudge / Prometheus-Vision / Trust-but-Verify ICCV 2025). Host injects `renderUiKit` (headless screenshot) and `judgeVisualParity` (multimodal call) via the same deps interface as `generate_image_asset`. Without injections the tool returns `status: "unavailable"` and the agent proceeds with the deterministic verifier alone.

  `decomposePrompt.ts` (EN + ZH) walks the agent through decompose → verify (both) → reconcile gaps → iterate (max 2) → done with HONEST cost summary. Per-decompose cost surfaces inline as a toast.

  Refs #225 (Phase 1 of the requested image → componentization → prototype workflow). Phase 2 (cross-page flows, state machines, prototype orchestration) is tracked separately.

- 0db17ee: Open dedicated file tabs as full-width file previews instead of retaining the workspace file browser and its thumbnail-preview controls. Keep the file browser in the Files tab.
- f2a9dbb: Preserve string-valued DESIGN.md component extensions with warnings, as required by Google's alpha consumer specification, rather than failing an otherwise working artifact. Keep malformed token values and runtime failures blocking and provide concrete object-shape repair guidance.

  Surface non-blocking metadata warnings in done results and preserve error/warning counts through repeated stream/history compaction. Update the design-system method's portability guidance without silently rewriting user tokens or changing the repair limit.

- b94d715: Add the built-in `design-reference-to-html` method skill for screenshot/mockup-to-HTML recreation. The skill is an Open CoDesign-native rewrite that uses workspace files, `App.jsx`, `DESIGN.md`, `preview()`, and optional `gen_image()` instead of vendoring external skill directories or browser scripts.
- 729e356: Reject preview interactions with controls disabled by an enclosing fieldset before changing values or dispatching input. Preserve the native first-legend exception and existing inert and ARIA-disabled checks.
- a9609e6: Pass optional source-path context to runtime verification and resolve local assets against the latest bound workspace under the workspace path lock. Preview and done share safe file access and source-relative base URLs, including nested source files. Missing or out-of-workspace assets still fail and now identify the requested resource URL.
- 729e356: Preserve URL encoding for local asset paths in exported ZIPs so filenames containing spaces, quotes, or parentheses load correctly in HTML and JSX designs without breaking CSS or JavaScript strings.
- 71dbd2f: Add an explicit, localized no-API-key option for custom providers. Preserve key-required defaults, round-trip authentication mode through settings, discover opted-in keyless endpoints without credentials, and require a key when switching back to authenticated mode.
- 0db17ee: Use supported default reasoning for GPT-6 Astra, including custom Responses gateways and helper requests. Preserve locally submitted generation state until its IPC response arrives so early stream completion cannot hide errors, artifacts, or token usage.
- ef1d37e: Follow the preferred runnable source as files arrive in a new workspace instead
  of remaining on an automatically selected document. Explicit file selections
  remain selected and do not carry over to another design.
- a8de894: Add window-local fullscreen preview for runnable JSX and HTML. Hide navigation panels without remounting the artifact, preserve form and navigation state, restore panels on exit, and forward unconsumed sandbox Escape events through the trusted preview bridge.
- d199c75: Queue text follow-ups or steer the next safe processing step during generation using pi's native message queues. Preserve per-design drafts, delivery receipts, and recoverable undelivered messages in local session JSONL without bypassing permission or question gates.
- e42b538: Refresh seven known, unedited bundled method skills during startup using exact
  historical hashes. Preserve custom and linked files, retain original backups,
  recover interrupted upgrades before missing-file seeding, and report upgrade
  counts and actionable failures without overwriting concurrent replacements.
- 87e6612: Keep fresh and partially seeded profiles compatible with filesystems that do not
  support hard links by exclusively copying missing method files. Never replace a
  concurrently created file or weaken guarded updates and recovery.
- 729e356: Order canonical chat snapshots by actual read dispatch after history seeding, preserving newer messages when seed requests complete out of order.
- f2758a6: Rewrite shared design prompts and seven on-demand methods around requested outcomes, coherent early slices, preserved journeys and focus, brief-grounded visual choices, and observed completion. Remove duplicated host procedures, rigid aesthetic quotas, and contradictory inferred-tweak prohibitions while retaining runtime, permission, source-format, brand, and data boundaries.

  Add mode/provenance/feature-profile budget contracts and validate the method's DESIGN.md example against the actual schema. Document official prompting sources and the limits of prompt-only validation. Existing local method copies require a separate ownership-preserving upgrade; this change does not overwrite user templates or alter model/provider settings.

- 729e356: Keep asynchronous clarification answers and file-field state bound to their request and session, so a cancelled upload cannot overwrite a later question with the same question ID.
- 971918b: Allow interactive preview forms to run client-side submit handlers while blocking native form navigation with browser-enforced CSP. Keep standalone exports and connected development-server policies unchanged.
- 726f08e: Resolve literal local asset references before JSX/TSX is encoded into standalone
  HTML. HTML and browser-rendered exports now inline these assets, while ZIP exports
  collect and rebase them without changing the included editable source. Preserve
  CSS URL quoting and safely encode text assets in quoted attributes.
- a3a08e6: Keep canvas comments tied to the host-resolved preview source file, including dedicated file tabs and persisted session comments. Edit prompts now use pi's read/edit tools and describe DOM targets as evidence rather than exact source-code locations; imported components still require source inspection.

  Correct duplicate/special-character ID selection and nested SVG rectangle tracking, preserve existing outlines, and clear stale selection when the selected layer disappears or the preview changes. Store comment rectangles in unscaled iframe coordinates and reject malformed geometry messages.

- 729e356: Preserve React component identity, hook state, effects, and uncontrolled inputs when applying live tweaks to components that read tokens during rendering. Saved tweaks and filesystem watcher acknowledgements no longer rerun the artifact module on this path.

  Artifacts that capture token values at module scope, render static root JSX/fragments/arrays, or use memoized components or memoization hooks (`useMemo` / `useCallback`) retain the previous module-replay behavior so their controls still update. Memoization hooks are conservatively classified even when a particular hook does not read tokens, because closures may capture values before the hook executes. An informational compatibility notice, localized in all four app languages, explains the resulting state reset once per artifact; it is not a runtime error and does not fail preview validation. Structural source replacements still rebuild the preview.

- 2d95f7f: Add a bounded preview select action for native single-selection dropdowns. Select options by exact value using browser input/change events, with explicit errors for disabled controls/options, unsupported multiple selects, and missing or ambiguous targets. Keep existing step budgets and keyboard restrictions.
- 8d4590a: Clarify that an early app checkpoint precedes secondary-screen implementation and full styling. Guide navigation revisions to preserve access to core record actions and return/recovery paths from newly reachable screens, checking changed entry paths instead of relying on old-screen checks or repeating every cosmetic check. These prompt contracts do not guarantee model compliance or fix runtime routing.
- 778ee51: Give the prompt composer a full-width, scrollable text surface with separate send and attachment controls. Bound its growth and attached references to preserve conversation space at smaller window sizes and higher zoom. Empty workspaces now show one getting-started preview without reserving a blank file-tree column.
- 346282c: Make canvas comments easier to read and operate with labeled primary actions, larger click targets, responsive composer placement, and comment-list actions that do not cover comment text.

  Cancel, close, and Escape now dismiss without saving, retaining the existing anchor-scoped draft. IME composition no longer triggers keyboard submission or dismissal. Saving prevents duplicate requests, shows progress and retry feedback, and returns focus after failure. A late save cannot close a newer comment anchor or queue its comment in a different design.

- 8cc9e52: Keep header navigation and controls from overlapping at narrow desktop widths and increased zoom. Place navigation and the model picker on a second row when needed, preserve the native window drag strip, and truncate long design, provider, and model names within their available space.
- 729e356: Compare active-message context against the immutable comment content submitted to the running generation, not just comment IDs. Revised comments remain pending and drafts are retained.

  Generation completion now uses an atomic expected-content check when marking comments applied. Only matching revisions are consumed; conflicts are reported without failing the completed generation. Late responses cannot overwrite newer visible edits, and editing an applied comment makes the new content pending. Existing explicit bulk marking remains compatible.

- 729e356: Keep generation ownership until cancellation and cleanup settle. Bind clarification,
  preview, verification, and workspace publication to cancellation; prevent cancelled
  prompt/recovery admissions and preserve queued messages for explicit recovery.

  Use pi's sequential ask barrier and reject remaining tools when the third failed
  done check exhausts repair attempts. Report incomplete verification without another
  provider turn or misclassifying the repair limit as a user cancellation.

- c63b1a4: Share in-flight startup design initialization so concurrent boot effects create only one blank design and workspace. Failed initialization remains retryable and continues to surface storage errors.
- 729e356: Keep inferred tweak controls and keyboard focus stable while replacing text or colors, including pauses across autosave. Validate inferred colors with the browser instead of treating arbitrary words as color names. Serialize and coalesce slow saves without losing newer drafts, weakening source conflict guards, or resetting artifact state. File/design switches and independent source replacements reset control inference; save conflicts remain visible and retain recoverable text.
- ef5677c: Explain missing, empty, or invalid tweak declarations for the active preview
  source instead of promising automatic controls. Surface malformed declarations
  without crashing the panel. Clarify that the tweaks scanner only discovers
  declarations: unrelated starter values are not controls for the active preview.
- 729e356: Add a versioned, session-scoped ask cancellation event and an unsubscribable preload listener so host cancellation can dismiss interrupted questions without submitting an answer.
- fb92207: Give run-preference preflight a bounded inventory of existing workspace files and recognize workspace DESIGN.md as design guidance. Document-only demo inputs no longer look like missing references just because App.jsx has not been generated. Inventory omissions remain unknown, not proof of missing files; substantive clarification stays available.

## 0.2.1

### Patch Changes

- 6cbb639: feat(desktop): add per-provider "Disable TLS verification" toggle for custom and imported providers. Unblocks connections to corporate gateways with self-signed or private-CA certificates that Node 22's built-in fetch cannot otherwise accept. Built-in providers (Anthropic, OpenAI, OpenRouter, Ollama) remain unaffected. (#229)
- 7a1977d: Add workspace-backed design creation, file browsing, project rebinding, and local preview modes, including a packaged preview runtime dependency fix so desktop builds include `ms` for `puppeteer-core`/`debug`.
- bf86fea: Add an HTTP proxy field to Settings → Advanced. The configured URL is applied to both Chromium's network stack and Node's HTTP(S)\_PROXY env vars, takes effect immediately, and persists across restarts.
- 7a1977d: Allow image generation to use the signed-in ChatGPT subscription OAuth path.

  The image asset provider list now includes ChatGPT subscription alongside
  OpenAI API and OpenRouter. When selected, `generate_image_asset` calls the
  ChatGPT Codex Responses backend with the stored OAuth bearer token instead of
  requiring an OpenAI API key.

- 8ea4bff: Update comment mode copy for saving comments and adding saved comments to chat.
- 8efd7e3: Harden desktop navigation so workspace Markdown links cannot replace the app window.
- f2bc0cd: Harden the workspace files watcher: fall back to polling for any filesystem watch error (previously only EPERM / EACCES / EISDIR), explicitly covering EINVAL, ENOSPC, and ERR_FEATURE_UNAVAILABLE_ON_PLATFORM that surface on Windows UNC paths, full disks, and Bun runtimes. Unknown FS errors now degrade gracefully instead of breaking the Files panel. (#352)
- Fix `pnpm dev` and Puppeteer preview spawns failing immediately when launched as uid 0 (root) — common inside containers, dev VMs, and CI runners. Both call sites now pass `--no-sandbox` to the spawned Chromium process when `process.getuid() === 0`, leaving the macOS / Windows / non-root Linux launch paths unchanged. (#356)
- 7a1977d: Refresh v0.2 user-facing copy for ChatGPT subscription sign-in and current provider support.

## 0.2.0

### Minor Changes

- 76a0043: feat(i18n): add full Spanish (ES) language support

  Added comprehensive Spanish (Neutral Latin American) localization.

  - Translated 889 core i18n keys in `packages/i18n`.
  - Translated dashboard templates and examples catalog in `packages/templates`.
  - Registered 'es' locale in the UI (LanguageToggle and Settings).
  - Updated IPC handlers in `apps/desktop` to support Spanish locale persistence.

- 4cec7ea: fix: tighten Always Reportable architecture after 3-reviewer audit

  Follow-up to the Always Reportable refactor, consolidating 3 parallel reviews (architecture / privacy / UX).

  **Privacy hardening:**

  - IPC validators (`parseReportableError`, `parseRecordRendererErrorInput`) cap `message` at 8 KB, `stack` at 16 KB, `context` at 4 KB serialized. Previously a compromised renderer could DoS via 10 MB stack.
  - `reportEvent` handler recomputes the dedup fingerprint main-side instead of trusting the renderer-supplied value.
  - `recordRendererError` IPC echoes the main-computed `fingerprint` back so the in-memory record matches the persisted row.

  **Correctness:**

  - All four main-side `computeFingerprint` call sites now pass `message` alongside `errorCode`+`stack`, matching the renderer signature. Previously stack-less errors produced different fingerprints on the two sides, which broke the "you already reported this" dedup.
  - `applyGenerateError` reads `err.code` from the rejected IPC error so `ATTACHMENT_TOO_LARGE` / `PROVIDER_HTTP_4XX` / `CONFIG_MISSING` survive into the Report (previously flattened to a generic `GENERATION_FAILED`). `NormalizedProviderError` fields are forwarded into `ReportableError.context`, so the preview's upstream block fires for real provider failures.

  **UX:**

  - `reportableErrorToast` helper + migrated 13 existing `pushToast({variant:'error'})` sites (onboarding imports, provider test/save/delete/activate, model save, reasoning save, open-log-folder fail, onboarding-blocked inline comments). Each now ships with a meaningful `code` and `scope` for triage rather than the generic `RENDERER_ERROR`/`renderer` fallback.
  - Diagnostics panel falls back to rendering the in-memory `reportableErrors[]` when SQLite is unavailable, with a "showing in-memory — will not persist" banner. Previously a DB-down user had no way to find their dismissed toast errors.
  - Bundle-saved toast now always fires after the bundle is written, regardless of whether `openExternal` or `clipboard.writeText` succeeds afterward. On failure, a follow-up recovery toast includes a copy-URL / paste-manually hint.

- c962aca: feat: boot-phase failure fallback + 24h fingerprint dedup

  - If the app crashes before the logger is ready (corrupt config, unreadable DB, SafeStorage init throw), we now write a sync `boot-errors.log` to the logs dir (falls back to `os.tmpdir()` if the primary location fails) and show a native three-button dialog — Copy diagnostic path / Open log folder / Quit. Previously the app would silently exit or show an opaque message.
  - Before a user clicks Open Issue in the Report dialog, we check a local `reported-fingerprints.json` (scoped 24 h, mode 0600) for the event's fingerprint. If it matches a prior submission, the dialog shows a small inline note with the previous issue URL: "You reported the same issue yesterday at 14:32." The user can still proceed — the check is informational.
  - After any successful `reportEvent`, the fingerprint is recorded locally. Older entries are pruned on write.

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

- 95412b9: feat: ChatGPT 订阅登录（Codex OAuth）

  支持用 ChatGPT Plus/Pro/Team 订阅直接调用 Codex 模型（`gpt-5.3-codex`、`gpt-5.4` 等），无需 API key。

  - PKCE OAuth 流程，本地 1455 端口 callback（冲突回退随机端口）
  - Token 存 `~/.config/open-codesign/codex-auth.json` (0600)，5 分钟过期前主动刷新，并发去重
  - 独立 token store，不与 Codex CLI 冲突
  - 生成请求走 `chatgpt.com/backend-api/codex/responses`，401 自动刷新重试
  - Settings 里加 "用 ChatGPT 订阅登录" 卡片

  Phase 2 待做：流式响应、usage/cost 记账、图片附件、完整 craft-directives system prompt。

- 0a0ff2e: feat(settings): add CLIProxyAPI preset quick-pick

  Adds CLIProxyAPI (`router-for-me/CLIProxyAPI`) as a first-class preset in the Add Provider menu. CLIProxyAPI is a Go local proxy on port 8317 that wraps Claude/Codex/Gemini OAuth subscriptions into a unified Anthropic Messages API — heavily requested by the Chinese user base.

  - `packages/shared`: new `cli-proxy-api` entry in `PROXY_PRESETS` (anthropic wire, `http://127.0.0.1:8317`)
  - `packages/i18n`: `settings.providers.cliProxyApi.*` keys in both `en.json` and `zh-CN.json` (preset name, description, api-key-optional hint, thinking-budget hint, model discovery strings)
  - `apps/desktop`: `AddProviderMenu` gains a CLIProxyAPI item that opens `AddCustomProviderModal` pre-filled with the CPA endpoint and anthropic wire; claude-cli identity headers are injected automatically by the existing `shouldForceClaudeCodeIdentity` path (no extra code needed)

- 19b2909: feat: diagnostic events table + fingerprint-based dedup

  - New `diagnostic_events` SQLite table persists error-level events from renderer crashes, provider errors (`provider.error` / `provider.error.final`), and final `CodesignError` throws from `generate` / `applyComment` / `generateTitle` handlers.
  - 200 ms dedup window: repeated failures with the same fingerprint bump `count` on the existing row rather than inserting new rows, keeping the table small under retry storms.
  - New `computeFingerprint({ errorCode, stack })` in `@open-codesign/shared`: 8-char sha1 over error code + top-3 normalized stack frames. Stable across different users / paths / line numbers so "the same bug" collapses to one group.
  - Retry-in-flight events are marked `transient: true`; the default list view hides them (UI lands in PR4).
  - Startup prunes the events table to 500 newest rows.
  - New `RENDERER_ERROR` code for uncaught errors forwarded from the renderer bridge.

  No user-visible behavior yet — this is the storage layer for the PR4 Diagnostics panel and "Report this" flow.

- 6c3a908: feat: diagnostics panel + Report bug flow + i18n error codes

  Closes the user → maintainer triage loop that PR1/PR2/PR3 built the foundation for.

  **Users see:**

  - New Settings → Diagnostics tab listing recent errors (code, scope, runId, message preview) with filter for retried-then-succeeded transient errors.
  - Error toasts no longer auto-dismiss and carry a Report button that opens a preview dialog.
  - Report dialog shows the event + free-text notes field + redaction toggles (include prompt / paths / URLs / 60 s action timeline — sensible defaults: timeline ON, others OFF).
  - One click on Open Issue launches a GitHub new-issue URL pre-filled with the summary (error code, fingerprint, env, upstream request-id, stack top 5 frames, user notes). Zip bundle with the full log + redacted config + summary.md is saved to Downloads for manual attachment.
  - Topbar shows an unread-error badge that jumps to the Diagnostics tab.
  - Every error toast / dialog copy is translated into zh-CN.

  **Plumbing:**

  - Renderer action timeline (last 40 entries / 60 s): forbids prompt text / paths / URLs by schema. Populated from `store.ts` at prompt submit, cancel, retry, provider/skill switch, design export, connection test, onboarding.
  - Two new IPC channels: `diagnostics:v1:listEvents`, `diagnostics:v1:reportEvent`.
  - `context_json` column added to `diagnostic_events` (additive migration) so provider errors persist `upstream_request_id` / status / retry_count alongside the row — the Report dialog renders them without reparsing main.log.
  - Markdown composer `composeSummaryMarkdown` is pure + unit-tested — re-used for both bundle and issue body.
  - `userFacingKey` field on every ERROR_CODE_DESCRIPTIONS entry pairs with i18n `err.<CODE>` keys in both locales.

  **Foundation fixes merged in:**

  - Fingerprint degeneracy: provider errors now use a synthetic `at provider (<status>:<code>)` frame so the Diagnostics panel groups sensibly.
  - Duplicate fingerprinting: retry's `provider.error.final` no longer persists a separate row; the outer handler's `recordFinalError` is the single final-error write path.
  - `generateTitle` / `applyComment` errors now use distinct scopes (`title`, `apply-comment`) instead of being indistinguishable from real generations.

- 9938fa4: feat(desktop): per-design workspace folder linking

  Users can now bind any open design to a local folder directly from the Files panel. Every file the agent writes is mirrored to that folder in real time, and the binding persists across restarts.

  - **Bind on first use** — click "Choose folder" in the Files panel to pick a workspace directory; the design is linked immediately and files are synced.
  - **Rebind with migration** — choosing a different folder prompts a confirmation dialog; existing tracked files are copied to the new location before the binding switches.
  - **Clear binding** — a "Disconnect folder" action removes the link without touching files on disk.
  - **Error surfacing** — write-through failures and IPC errors (migration collision, missing tracked file) are now reported to the UI instead of being silently swallowed.
  - **Cross-platform path comparison** — the rebind dialog no longer triggers falsely when paths differ only by trailing slash or directory-separator style.

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

- d3a62fe: feat(providers): first-class Ollama support + editable custom providers

  - Ollama joins the builtin provider set. `requiresApiKey: false` on the schema lets any provider — builtin or custom — opt out of API keys; `isKeylessProviderAllowed` now honors it. `extractModelIds` accepts the `{name}` shape used by Ollama's `/api/tags` endpoint as a fallback.
  - New `ollama:v1:probe` IPC does a 2s liveness check against `http://localhost:11434/api/tags`, so the UI can distinguish "running", "not installed", and "unreachable" states without racing the 10s models-list timeout.
  - Custom and builtin providers now have an `Edit` action. `AddCustomProviderModal` accepts an `editTarget` prop that pre-fills every field and routes save through `updateProvider` (rotates the stored secret only when the user actually types a new one — leaving it blank keeps the current mask). Builtin rows lock `baseUrl`/`wire` so users can't accidentally repoint `anthropic` at an unrelated host; only the API key and default model are editable.
  - `config:v1:update-provider` gained an optional `apiKey` field with tri-state semantics (omit = keep, empty string = clear, non-empty = rotate). Runs against missing-entry builtins too, seeding from `BUILTIN_PROVIDERS` so edits work on fresh installs.

### Patch Changes

- b8645d9: fix: keep chatgpt-codex meta replies as plain text

  - `chatgpt-codex` no longer turns non-design or meta prompts like "你是什么模型" into an immediate `design.html` artifact.
  - The Codex generate path now separates artifact HTML from surrounding assistant text, matching the main generate pipeline more closely.
  - The renderer only marks a run as `artifact_delivered` when an actual artifact exists, so plain-text replies no longer appear as generated files.

- 4c66392: Harden HTML, URL, marker, stack-frame, and retry parsing paths flagged by CodeQL during the v0.2 mainline promotion.
- a965e58: fix: send attached screenshots to ChatGPT Codex as image inputs

  Image attachments in the desktop app were previously reduced to filename-only hints on the `chatgpt-codex` route, so models like `gpt-5.4` could ignore uploaded screenshots entirely.

  This change keeps the existing text-attachment behavior, but reads supported image files into data URLs and forwards them as Responses `input_image` parts for ChatGPT Codex generations.

- 3d7b74e: feat(settings): auto-detect running CLIProxyAPI and show import banner

  When the Models tab mounts, probes `http://127.0.0.1:8317/v1/models` via the existing `testEndpoint` IPC bridge. If CLIProxyAPI is running and no provider is already configured at that address, displays a `LocalCpaImportCard` banner above the provider list offering one-click import into `AddCustomProviderModal`. The banner is dismissible and the preference persists to `localStorage` via key `cpa-detection-dismissed-v1`.

- 0a0ff2e: feat(settings): auto-discover models in custom provider modal

  When adding a custom provider (e.g. a CPA at http://127.0.0.1:8317), the modal now probes the endpoint automatically after the user types a valid http(s) baseUrl, debouncing 500ms. A spinner appears inline next to the "Default model" label while discovery runs, then either a green "Found N models" badge or a muted "Could not connect" hint.

  On success the "Default model" input becomes a `<select>` pre-populated with discovered model IDs, with smart auto-selection prioritising claude-sonnet-4-5 → claude-opus → claude-sonnet → gemini-2.5-pro → gpt-5 → first in list. A "Enter manually" escape hatch lets users type any ID instead, and a "Pick from list" link restores the dropdown. The probe re-fires when the API key or wire protocol changes. Empty or non-http(s) baseUrls are skipped so the existing manual flow is completely unaffected.

- 576e341: Block design system linking before onboarding and show a friendly renderer diagnostic instead of surfacing the main-process guard error.
- 69d09fa: Improve exporter fidelity by resolving workspace-local assets, bundling ZIP resources, preserving Markdown tables, supporting PDF header/footer options, and rendering PPTX slides from Chrome screenshots.
- 8058752: Show a virtual `index.html` in the Files panel when a generated preview exists but no workspace file rows are available.
- bbf69c7: Fix: allow larger binary attachments (images/png) up to 10MB. Binary attachments only contribute filename to context so size limit can be larger.
- a799cab: Show a friendly localized message when ChatGPT OAuth rejects token exchange for unsupported countries or regions.
- 011b25d: Fix: preserve the generation-timeout reason so long runs no longer surface a bare "Request was aborted." Provider SDKs rewrite aborted fetches into a generic message that drops `signal.reason`; the generate IPC now re-surfaces the stashed `GENERATION_TIMEOUT` CodesignError (with configured seconds + Settings path) when the controller was aborted by our own timer. Settings → Advanced → Generation timeout also gains 10m / 20m / 30m / 1h / 2h choices so the default 1200s and longer full-PDP runs can actually be configured without the dropdown silently downgrading the stored value.
- b793a8f: Fix Settings so Ollama is hidden until users add the local provider manually.
- 418e5a8: Classify 403 generation responses that say requests were blocked as gateway or reverse-proxy blocks instead of invalid API keys.
- 022e1b6: feat(diagnostics): bridge generate failures to diagnose() hypotheses (#130)

  - Main process `codesign:v1:generate` catch block now tags the thrown error with `upstream_status` / `upstream_provider` / `upstream_baseurl` / `upstream_wire` so the renderer can reason about the failure without re-parsing `err.message`.
  - New `diagnoseGenerateFailure()` in `@open-codesign/shared` maps generate-time failures to the same `DiagnosticHypothesis` shape the connection-test path already uses: 404 / "404 page not found" → missing `/v1`; 5xx with "not implemented" or "page not found" body → gateway does not implement the provider API; 400 with "instructions" body → openai-responses wire misconfigured; 401/403/429 reuse existing hypotheses.
  - Renderer `applyGenerateError` now appends the most-likely-cause sentence to the failure toast description and, for the missing-`/v1` case, surfaces an "Apply fix" action that updates the provider's baseUrl via `config:v1:update-provider` — addressing the Win11 relay-gateway failure in #130 with a one-click fix rather than a dead-end error message.
  - Adds new i18n cause keys (`gatewayIncompatible`, `openaiResponsesMisconfigured`, `serverError`) and fix keys (`switchWire`) in en + zh-CN.

- aa37f6f: Harden desktop provider setup by sanitizing agent-supplied SVG choice icons, storing new API keys with Electron safeStorage when available, redacting encrypted secret rows from diagnostics, and requiring explicit opt-in before testing local or private-network provider URLs.
- 441e7c7: fix: adversarial review round 2 — close remaining CRITICAL / HIGH privacy gaps

  A second adversarial review pass turned up three critical + four high-severity issues the first round missed. All fixed here.

  **Privacy (CRITICAL):**

  - Bundle's `main.log` was being zipped raw — completely bypassing the user's `includePromptText / includePaths / includeUrls` toggles. A user unchecking "Include paths" to protect `~/Users/name/...` still had those paths go verbatim to the public GitHub issue via the zipped log. Now every line of `main.log` in the bundle runs through the same per-line scrubber as `summary.md`. The generic "Export diagnostic bundle" button (no per-event toggles) defaults to redacting all three categories — safest choice.
  - Report dialog's preview now honors the redaction toggles live. Previously the `<pre>` showed `event.message` verbatim regardless of toggle state, so users had no way to verify redaction. A new client-side `redact.ts` mirrors the main-process regexes exactly (all 3 branches of `scrubPromptInLine`), and the preview re-runs on every toggle change. Provider-scope events now also display an "Upstream context" block (provider, status, request-id, retry count, redacted body head) — previously the body head was posted publicly without ever being shown to the reporter.
  - Path redaction regex broadened to cover `/var/folders/...` (macOS tmp), `/tmp/...`, `/etc/...`, `/private/var/...`. These paths routinely appear in fs error messages and were leaking before.

  **Correctness (HIGH):**

  - `preferences-ipc.ts` schema migration 4→5 no longer seeds `diagnosticsLastReadTs` to `0`. Upgrading users were getting a "99+" unread badge on first launch (every historical error row counted as unread). Now the migration seeds to `Date.now()` — fresh installs still start at 0 because the DB is empty too.
  - `providerContext` store no longer evicts an unrelated run's context when a second `provider.error` event arrives for an already-tracked run.
  - `writeAtomic` now unlinks its tmp file on write/rename failure, and a `cleanupStaleTmps` sweep on boot removes litter left by crashed processes.

- e622d62: fix: 3-reviewer adversarial round — privacy, UX, correctness

  Third consolidated round of fixes from three parallel adversarial reviewers.

  **Privacy (from R1):**

  - Issue URL `logs=` and `actual=` fields now go through the same redact pipeline as `summary.md`. Previously the URL (which ends up in browser history + referrer + shell history) silently ignored the user's redact toggles.
  - `bundlePath` in the issue URL now renders as `~/Downloads/...` rather than `/Users/<realUsername>/...`, so OS username isn't leaked through the link.
  - `config-redacted.toml` now applies path + URL redaction per toggle, so raw IPs in `baseUrl` and filesystem paths in `[designSystem]` get masked when the user unchecks Paths/URLs. The filename is no longer a lie.
  - `API_KEY_RE` broadened to catch Google Gemini `AIzaSy…`, AWS `AKIA…`, and 43-char Azure base64 keys.
  - `setWindowOpenHandler` is now gated through `isAllowedExternalUrl`, matching the existing allowlist for the IPC channel.
  - `showItemInFolder` rejects paths outside config/logs/Downloads to prevent a compromised renderer from revealing arbitrary files in Finder.

  **UX (from R2):**

  - Redaction placeholders changed from `<prompt omitted>` / `<path omitted>` / `<url omitted>` to `[prompt omitted]` / `[path omitted]` / `[url omitted]`. GitHub's markdown renderer was stripping the angle-bracket form as HTML tags, leaving users and triagers looking at empty redacted fields.
  - `summary.md` Message field now uses a backtick-safe inline code span (`mdInlineCode`), so error messages containing backticks don't eat the lines that follow.
  - Report dialog panel has `max-h-[90vh] overflow-y-auto` so buttons stay on-screen at 1280×720 viewports.
  - Dedup warning now shows the prior issue number (`#123`) when extractable from the stored URL.
  - Confirm step ("Yes, open anyway") has a 60-second countdown visible on the button.
  - Notes-too-long error is now localized.
  - Toast Report button shows a Loader2 spinner while the auto-record IPC is resolving.
  - Report bundle-saved toast only appears AFTER `openExternal` / `clipboard.writeText` succeeds, so a silent failure doesn't flash a green success toast alongside an error banner.
  - User notes are now injected into the bug_report.yml `actual` field, not just the zipped bundle.
  - Windows `platform_version` maps NT build (`10.0.22631`) to marketing name (`Windows 11 (10.0.22631)`).

  **Correctness (from R3):**

  - Fingerprint basis includes a hash of `message` when the stack is empty. Previously all renderer errors without stacks collapsed to the same fingerprint and triggered false "already reported" warnings.
  - `ReportEventDialog` is now mounted once at the App root via a single store slice (`activeReportEventId`). Previously each error toast mounted its own dialog, so opening Report on two toasts stacked two overlays.

  **i18n:**

  - Filled in three missing English keys (`loading.tokens`, `settings.providers.missingKey`, `settings.providers.addKey`).
  - `{relative}` single-brace interpolation finally fixed (it was rendering literally because i18next expects `{{relative}}`).

  **Test coverage:**

  - Added regression tests for each privacy leak, the fingerprint collision, the store's auto-record chain, and the dedup countdown.
  - 779 desktop + 153 shared tests pass.

- d815de5: fix: logging / diagnostics follow-ups from adversarial review

  Addresses 11 bugs and UX gaps found in an adversarial review of PR1-5:

  **Data correctness:**

  - Provider error context (upstream_request_id, upstream_status, retry_count, redacted_body_head) is now carried from the transient retry rows through to the final event row that users actually Report on — previously it lived only on a hidden sibling row.
  - `generateTitle` now routes through `completeWithRetry`, so title-generation failures emit the same structured `provider.error` events as regular generations instead of bubbling as raw exceptions.
  - The Report button on error toasts now resolves the exact event by `runId` rather than falling back to "the most recent diagnostic event" — so with multiple errors in flight each toast opens the right dialog. When no matching event is recorded yet, the button is disabled with a tooltip.
  - ErrorBoundary's Report button captures a timestamp on fallback mount and only accepts events recorded after it — render crashes no longer report whatever unrelated old error happened to be at index 0.

  **Privacy:**

  - Dropped the `请` / length-based heuristic in `looksLikePrompt` that was wiping out any Chinese error message longer than 200 chars containing the common word "请". Detection is now purely structural (JSON-key / field-marker patterns).
  - Log tail inside `summary.md` now scrubs prompt JSON per-line when `includePromptText` is off, rather than only replacing whole lines that matched a coarse heuristic.

  **UX:**

  - Diagnostics panel distinguishes "no events yet" from "snapshots DB unavailable" — the latter shows a warning pointing at main.log instead of cheerfully reporting zero failures.
  - After clicking Open Issue / Copy summary in the Report dialog, a toast confirms where the bundle was saved and offers a "Show in folder" action so users can actually attach it to the GitHub issue.
  - Report dialog auto-focuses the notes textarea on open and traps Tab/Shift-Tab within the dialog.

  **Defense in depth:**

  - Main-process IPC now caps `notes` at 4000 chars and `timeline` at 100 entries — a compromised renderer can no longer push 50 MB payloads.

  **Housekeeping:**

  - Cleaned stale TODO referencing the now-shipped Settings surface.

- b2a6d15: fix: close v1.0-blocking gaps in the logging / diagnostics pipeline

  Addresses every "must ship before v1.0" item surfaced by the adversarial review, plus a handful of close-to-free UX polish.

  **Main-process hardening:**

  - Boot-phase dialog now gates on `app.isReady()` — calling `dialog.showMessageBoxSync` before the framework is ready on Win/Linux is undefined; if we're pre-ready we write the path to stderr instead and let the user find the boot-errors.log manually.
  - Post-init listeners (`app.on('activate', …)`) now route `createWindow()` throws through the same boot-fallback writer + gated dialog instead of silently swallowing.
  - `reported-fingerprints.json` writes are atomic (`writeFileSync(tmp) → renameSync`) so a crash between truncate and write, or two concurrent Electron instances, can no longer clobber the file.
  - Redaction regex in `summary.md` generation now covers Windows drive-letter, UNC, `~/…`, `/root`, `/opt`, `/Applications`; URL regex adds `wss?:` and `file:`. Negative test guards against false-positives on dates and ratios.

  **Renderer polish:**

  - Unread-error badge `lastReadTs` is now persisted via the preferences IPC, so marking diagnostics read survives a restart.
  - Error toasts cap at 3 — a new error drops the oldest to prevent the viewport filling with sticky stacks.
  - Badge above 99 renders as `99+` so the TopBar doesn't widen unboundedly.
  - Report dialog's four redaction toggles now carry inline hints explaining what each one reveals.

  **Internal:**

  - `providerContext` store extracted into its own module with direct test coverage.

- 4c66392: refactor: make create prompts manifest-first

  - Replace keyword-routed create prompt composition with deterministic base sections plus resource manifest summaries.
  - Move heavyweight guidance into lazy-loaded skills and remove stale single-shot artifact prompt exports.
  - Remove full skill body injection helpers and demote old tool names in the chat working-card UI.
  - Add artifact composition, chart rendering, and craft polish skill manifests for explicit progressive disclosure.

- 863db3c: feat(ui): search input in model switcher dropdown

  Long provider catalogs (DeepSeek, Zhipu, OpenRouter, …) return 40+ model IDs; scrolling by wheel to find the one you actually use is painful. The topbar/sidebar model switcher now shows a search box at the top of the dropdown whenever the list crosses an 8-item threshold, filtering case-insensitively by substring. Path-style IDs (`deepseek-ai/DeepSeek-R1-Distill-Qwen-7B`) and tag-style IDs (`llama3.2:latest`) both match naturally.

  The input auto-focuses on open, resets when the dropdown closes, and renders a distinct "no matches for <query>" message so users can tell a search miss apart from a provider with genuinely zero models.

  Community request from chengmo — thanks for the nudge.

- 4111928: Disable startup update checks by default and treat missing electron-updater channel metadata as a non-error condition.
- 41efd48: Repair stale user scaffold manifests with missing bundled metadata so built-in scaffold validation stays healthy after upgrades.
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

- 5d22e60: fix(renderer): Settings active-provider card no longer misrepresents the current model

  When the `/models` endpoint returns a partial list (or one that does not include the currently-active model id — common with custom gateways, manually-edited TOML, or provider-specific aliasing), the native `<select>` fell back to rendering `options[0]`. The card then visually claimed the active model was whatever happened to sit at the top of the fetched list, while the top-bar `ModelSwitcher` and the actual generation request still used the real active id (see issue #136).

  Now when `config.modelPrimary` is not in the fetched list, the active id is pinned at the top of the dropdown with an `(active, not in provider list)` hint. The select always matches reality, and users can see at a glance that their configured model is not one the provider advertised — a useful signal when debugging 4xx errors (related: #124, #134).

- 90f25d0: Show a clearer transport-interrupted explanation when generation fails with opaque `terminated` errors.
- 8fc9f56: Fall back to polling workspace files when native recursive watching is blocked by permission errors.
- cd71db4: Show clearer guidance when a workspace folder is already bound to another design.
- 75f2e2a: Load existing workspace text files into the agent runtime and serve preview-relative workspace assets through a bounded `workspace://` protocol.
