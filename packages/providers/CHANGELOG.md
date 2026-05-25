# @open-codesign/providers

## 0.2.1

### Patch Changes

- 7a1977d: Allow image generation to use the signed-in ChatGPT subscription OAuth path.

  The image asset provider list now includes ChatGPT subscription alongside
  OpenAI API and OpenRouter. When selected, `generate_image_asset` calls the
  ChatGPT Codex Responses backend with the stored OAuth bearer token instead of
  requiring an OpenAI API key.

- 7a1977d: Refresh v0.2 user-facing copy for ChatGPT subscription sign-in and current provider support.
- Updated dependencies [7a1977d]
- Updated dependencies [6cbb639]
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

- 95412b9: feat: ChatGPT 订阅登录（Codex OAuth）

  支持用 ChatGPT Plus/Pro/Team 订阅直接调用 Codex 模型（`gpt-5.3-codex`、`gpt-5.4` 等），无需 API key。

  - PKCE OAuth 流程，本地 1455 端口 callback（冲突回退随机端口）
  - Token 存 `~/.config/open-codesign/codex-auth.json` (0600)，5 分钟过期前主动刷新，并发去重
  - 独立 token store，不与 Codex CLI 冲突
  - 生成请求走 `chatgpt.com/backend-api/codex/responses`，401 自动刷新重试
  - Settings 里加 "用 ChatGPT 订阅登录" 卡片

  Phase 2 待做：流式响应、usage/cost 记账、图片附件、完整 craft-directives system prompt。

- 013fd34: feat: normalize provider errors into structured log events

  - `normalizeProviderError(err, provider, retryCount)` produces a flat `NormalizedProviderError` object capturing `upstream_status`, `upstream_code`, `upstream_request_id`, `retry_count`, and the first 512 bytes of the response body with API keys / bearer tokens redacted.
  - `completeWithRetry` emits `provider.error` on each retried attempt and `provider.error.final` when retries are exhausted, via an injected logger. The `runId` set by PR1's `AsyncLocalStorage` automatically joins every event.
  - New `PROVIDER_UPSTREAM_ERROR` code in the shared registry for errors that reach the final throw without a more specific classification.
  - Net effect: triaging a user-reported 4xx/5xx now works from the log alone — no follow-up request needed for `request-id` or response body.

  Also includes two PR1 follow-ups: corrects two misplaced `biome-ignore` comments (`ChatMessageList.tsx`, `chat-ui.jsx`) and makes `logger.rotation.test.ts` path-separator portable for future Windows CI.

### Patch Changes

- 63fa316: Fix: retry first-turn agent generation on transient provider errors (5xx, 429, network). The agent runtime now wraps `agent.prompt()` + `waitForIdle()` in a backoff loop for the first turn only — multi-turn requests still fail fast to avoid corrupting mid-session tool state. Extracted a generic `withBackoff` helper in `@open-codesign/providers` that shares the existing classify/jitter/Retry-After/abort logic with `completeWithRetry`. (#125)
- 4c66392: Harden HTML, URL, marker, stack-frame, and retry parsing paths flagged by CodeQL during the v0.2 mainline promotion.
- bc7b311: Use conservative OpenAI Chat compatibility settings for DeepInfra endpoints to avoid unsupported OpenAI extension fields during generation.
- a799cab: Show a friendly localized message when ChatGPT OAuth rejects token exchange for unsupported countries or regions.
- b7ab2c8: Fix 400 "developer is not one of ['system', 'assistant', 'user', 'tool', 'function']" when talking to OpenAI-compatible gateways (Qwen/DashScope, DeepSeek, GLM/BigModel, Moonshot, …) through a custom provider. `synthesizeWireModel` no longer hard-codes `reasoning: true`; it only flags reasoning for Anthropic, openai-responses, openai-codex-responses, or OpenAI-official endpoints on known reasoning model families (o1/o3/o4/gpt-5). (#183)
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

- 4c66392: refactor: make create prompts manifest-first

  - Replace keyword-routed create prompt composition with deterministic base sections plus resource manifest summaries.
  - Move heavyweight guidance into lazy-loaded skills and remove stale single-shot artifact prompt exports.
  - Remove full skill body injection helpers and demote old tool names in the chat working-card UI.
  - Add artifact composition, chart rendering, and craft polish skill manifests for explicit progressive disclosure.

- 09f976a: Keep Kimi and MiniMax OpenAI Chat models on the non-reasoning system-role path so compatible gateways do not reject `developer` messages.
- d3a62fe: feat(providers): first-class Ollama support + editable custom providers

  - Ollama joins the builtin provider set. `requiresApiKey: false` on the schema lets any provider — builtin or custom — opt out of API keys; `isKeylessProviderAllowed` now honors it. `extractModelIds` accepts the `{name}` shape used by Ollama's `/api/tags` endpoint as a fallback.
  - New `ollama:v1:probe` IPC does a 2s liveness check against `http://localhost:11434/api/tags`, so the UI can distinguish "running", "not installed", and "unreachable" states without racing the 10s models-list timeout.
  - Custom and builtin providers now have an `Edit` action. `AddCustomProviderModal` accepts an `editTarget` prop that pre-fills every field and routes save through `updateProvider` (rotates the stored secret only when the user actually types a new one — leaving it blank keeps the current mask). Builtin rows lock `baseUrl`/`wire` so users can't accidentally repoint `anthropic` at an unrelated host; only the API key and default model are editable.
  - `config:v1:update-provider` gained an optional `apiKey` field with tri-state semantics (omit = keep, empty string = clear, non-empty = rotate). Runs against missing-entry builtins too, seeding from `BUILTIN_PROVIDERS` so edits work on fresh installs.

- Updated dependencies [4cec7ea]
- Updated dependencies [4391788]
- Updated dependencies [4c66392]
- Updated dependencies [0a0ff2e]
- Updated dependencies [19b2909]
- Updated dependencies [6c3a908]
- Updated dependencies [418e5a8]
- Updated dependencies [022e1b6]
- Updated dependencies [441e7c7]
- Updated dependencies [e622d62]
- Updated dependencies [d815de5]
- Updated dependencies [a5f1cc0]
- Updated dependencies [b2a6d15]
- Updated dependencies [013fd34]
- Updated dependencies [d3a62fe]
  - @open-codesign/shared@0.2.0
