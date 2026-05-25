# @open-codesign/shared

## 0.2.1

### Patch Changes

- 6cbb639: feat(desktop): add per-provider "Disable TLS verification" toggle for custom and imported providers. Unblocks connections to corporate gateways with self-signed or private-CA certificates that Node 22's built-in fetch cannot otherwise accept. Built-in providers (Anthropic, OpenAI, OpenRouter, Ollama) remain unaffected. (#229)
- 7a1977d: Allow image generation to use the signed-in ChatGPT subscription OAuth path.

  The image asset provider list now includes ChatGPT subscription alongside
  OpenAI API and OpenRouter. When selected, `generate_image_asset` calls the
  ChatGPT Codex Responses backend with the stored OAuth bearer token instead of
  requiring an OpenAI API key.

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

- 022e1b6: feat(diagnostics): bridge generate failures to diagnose() hypotheses (#130)

  - Main process `codesign:v1:generate` catch block now tags the thrown error with `upstream_status` / `upstream_provider` / `upstream_baseurl` / `upstream_wire` so the renderer can reason about the failure without re-parsing `err.message`.
  - New `diagnoseGenerateFailure()` in `@open-codesign/shared` maps generate-time failures to the same `DiagnosticHypothesis` shape the connection-test path already uses: 404 / "404 page not found" → missing `/v1`; 5xx with "not implemented" or "page not found" body → gateway does not implement the provider API; 400 with "instructions" body → openai-responses wire misconfigured; 401/403/429 reuse existing hypotheses.
  - Renderer `applyGenerateError` now appends the most-likely-cause sentence to the failure toast description and, for the missing-`/v1` case, surfaces an "Apply fix" action that updates the provider's baseUrl via `config:v1:update-provider` — addressing the Win11 relay-gateway failure in #130 with a one-click fix rather than a dead-end error message.
  - Adds new i18n cause keys (`gatewayIncompatible`, `openaiResponsesMisconfigured`, `serverError`) and fix keys (`switchWire`) in en + zh-CN.

- d3a62fe: feat(providers): first-class Ollama support + editable custom providers

  - Ollama joins the builtin provider set. `requiresApiKey: false` on the schema lets any provider — builtin or custom — opt out of API keys; `isKeylessProviderAllowed` now honors it. `extractModelIds` accepts the `{name}` shape used by Ollama's `/api/tags` endpoint as a fallback.
  - New `ollama:v1:probe` IPC does a 2s liveness check against `http://localhost:11434/api/tags`, so the UI can distinguish "running", "not installed", and "unreachable" states without racing the 10s models-list timeout.
  - Custom and builtin providers now have an `Edit` action. `AddCustomProviderModal` accepts an `editTarget` prop that pre-fills every field and routes save through `updateProvider` (rotates the stored secret only when the user actually types a new one — leaving it blank keeps the current mask). Builtin rows lock `baseUrl`/`wire` so users can't accidentally repoint `anthropic` at an unrelated host; only the API key and default model are editable.
  - `config:v1:update-provider` gained an optional `apiKey` field with tri-state semantics (omit = keep, empty string = clear, non-empty = rotate). Runs against missing-entry builtins too, seeding from `BUILTIN_PROVIDERS` so edits work on fresh installs.

### Patch Changes

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

- 4c66392: Harden HTML, URL, marker, stack-frame, and retry parsing paths flagged by CodeQL during the v0.2 mainline promotion.
- 0a0ff2e: feat(settings): add CLIProxyAPI preset quick-pick

  Adds CLIProxyAPI (`router-for-me/CLIProxyAPI`) as a first-class preset in the Add Provider menu. CLIProxyAPI is a Go local proxy on port 8317 that wraps Claude/Codex/Gemini OAuth subscriptions into a unified Anthropic Messages API — heavily requested by the Chinese user base.

  - `packages/shared`: new `cli-proxy-api` entry in `PROXY_PRESETS` (anthropic wire, `http://127.0.0.1:8317`)
  - `packages/i18n`: `settings.providers.cliProxyApi.*` keys in both `en.json` and `zh-CN.json` (preset name, description, api-key-optional hint, thinking-budget hint, model discovery strings)
  - `apps/desktop`: `AddProviderMenu` gains a CLIProxyAPI item that opens `AddCustomProviderModal` pre-filled with the CPA endpoint and anthropic wire; claude-cli identity headers are injected automatically by the existing `shouldForceClaudeCodeIdentity` path (no extra code needed)

- 418e5a8: Classify 403 generation responses that say requests were blocked as gateway or reverse-proxy blocks instead of invalid API keys.
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

- a5f1cc0: feat: structured logging foundation

  - Every workspace package now logs through an injected `CoreLogger` instead of `console.*` — renderer and workspace signals both reach `main.log`.
  - Renderer `console.*` bridge preserves object structure (no more `[object Object]`) with an 8 KB per-arg size cap.
  - `runId` from `AsyncLocalStorage` auto-attaches to every log line inside a generation handler; IPC payloads unchanged.
  - Log file retention extended to 3 × 5 MB (`main.log` / `main.old.log` / `main.old.1.log`); rotation is resilient to Windows EBUSY / TOCTOU.
  - Legacy settings IPC deprecation warnings are deduped via `warnOnce` — first occurrence logs once, repeats are suppressed.
  - Biome enforces `no-console` in main / core / providers / exporters / shared.
  - `generationId` schema tightened to alphanumeric + `_`/`-`, max 128 chars (defense in depth for log-line injection).

  Breaking for out-of-tree consumers implementing `CoreLogger`: the interface now requires a `warn` method alongside `info` / `error`.

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

- 013fd34: feat: normalize provider errors into structured log events

  - `normalizeProviderError(err, provider, retryCount)` produces a flat `NormalizedProviderError` object capturing `upstream_status`, `upstream_code`, `upstream_request_id`, `retry_count`, and the first 512 bytes of the response body with API keys / bearer tokens redacted.
  - `completeWithRetry` emits `provider.error` on each retried attempt and `provider.error.final` when retries are exhausted, via an injected logger. The `runId` set by PR1's `AsyncLocalStorage` automatically joins every event.
  - New `PROVIDER_UPSTREAM_ERROR` code in the shared registry for errors that reach the final throw without a more specific classification.
  - Net effect: triaging a user-reported 4xx/5xx now works from the log alone — no follow-up request needed for `request-id` or response body.

  Also includes two PR1 follow-ups: corrects two misplaced `biome-ignore` comments (`ChatMessageList.tsx`, `chat-ui.jsx`) and makes `logger.rotation.test.ts` path-separator portable for future Windows CI.
