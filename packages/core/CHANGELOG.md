# @open-codesign/core

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
