# Full Review Root Fix Plan

## Scope

- Review the current `dev/v0.2` checkout against `AGENTS.md`, `docs/VISION.md`, `docs/PRINCIPLES.md`, and `docs/v0.2-plan.md`.
- Run broad automated checks before choosing fixes.
- Fix only substantiated issues, with tests at the right boundary.

## Steps

1. Capture repo status and current architecture constraints.
2. Run lint, typecheck, unit tests, and targeted build checks as needed.
3. Triage failures to root causes instead of symptom patches.
4. Patch code and tests with minimal dependency and storage impact.
5. Re-run verification and record remaining risk.

## Findings

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` were green before changes, but build/static review exposed real infrastructure drift.
- Desktop CSS build produced an invalid Tailwind arbitrary value: `var(--space-1_5)` inside `calc(...)` became `var(--space-1 5)`.
- Root `vite@<6.4.2` override forced VitePress from its Vite 5 line to Vite 8/Rolldown, producing repeated plugin compatibility warnings. Pinning VitePress directly to Vite 5 failed because the root esbuild override creates an incompatible Vite 5 + esbuild 0.27 pairing, so the working scoped pin is Vite 6.4.2.
- Desktop used Vite 8 with `electron-vite@5`, whose peer range is Vite 5/6/7. Aligning desktop to Vite 7.3.2 and plugin-react 5.2.0 removes that peer mismatch.
- Turbo declared outputs for no-output `typecheck` and non-coverage `test`, causing false warnings. Build outputs also missed VitePress and electron-builder artifacts.
- Renderer store tests were missing the preload `chat` and `comments` surfaces in several design-switching mocks, so successful test runs printed noise about `seedFromSnapshots`, `append`, and `comments.list` being undefined.
- `apps/desktop` ordinary `build` mixed two phases: fast Vite compilation and slow installer packaging. CI and release workflows already separate these (`electron-vite build` in CI, `release` for packaging), so the local/root `pnpm build` path should follow the same boundary.
- Agent defaults still exposed legacy helper tools (`read_url`, `read_design_system`, `list_files`). `read_url` performed direct network fetch outside the permission model; `read_design_system` duplicated prompt-injected DESIGN.md context; `list_files` duplicated `text_editor.view()` directory behavior. A second cleanup pass removed the unused factories/exports entirely; the renderer still labels old persisted tool-call rows for history compatibility.
- Agent-facing instructions still described pseudo tool calls (`text_editor.create(...)`, bare `view("index.html")`, and `text_editor str_replace`) even though the actual runtime tool is `str_replace_based_edit_tool` with a command payload. That mismatch could make the model call nonexistent tools during generation, pending-edit batches, or comment revisions.
- Reference URLs, local attachments, and selected artifact DOM snippets were injected as plain prompt context while only DESIGN.md-derived tokens were wrapped as untrusted scanned content. External pages, user files, and artifact HTML can contain prompt-like text, so all four context sources now share the same untrusted wrapper and XML escaping boundary. Apply-comment also no longer pre-embeds the same context before calling the agent, so supporting context is injected once.
- `str_replace_based_edit_tool` documented `view_range: [-1, -1]` as wrong, but the implementation treated `rawStart = -1` as line 1. That let repeated ranged views bypass the full-file view budget and re-inject the entire artifact. `-1` now means EOF for both bounds, and `[-1, -1]` returns only the last line.
- The agent guidance still described `view_range: [-1, -1]` as "wrong" after the EOF fix. Updated the prompt so model-facing instructions now match the implementation: it reads only the final line and is not a full-file shortcut.
- Local `electron-builder --dir` smoke first entered packaging but stayed in "searching for node modules" for more than 16 minutes. The root cause was partly that desktop main output externalized `@open-codesign/*` workspace packages, forcing electron-builder to resolve and package workspace dependencies instead of the already-built bundle. Desktop now bundles workspace packages into the Vite output, keeps them as dev dependencies, and keeps only true runtime externals in production dependencies.
- `electron-builder --dir` then exposed a real plist parse failure: the root `@xmldom/xmldom@<0.8.13` override used the open range `>=0.8.13`, which resolved to `0.9.10`; `plist@3.1.0` calls `DOMParser.parseFromString(..., undefined)`, which `xmldom@0.9.x` rejects. The override is now pinned to `0.8.13`, satisfying the security floor without crossing the plist compatibility boundary.
- `electron-builder --dir` also surfaced missing desktop app metadata warnings. Added desktop package `description` and `author` so packaged app metadata no longer depends on root-package fallback.
- Desktop's bundled main build still emitted a Vite warning because `packages/core/src/agent.ts` dynamically imported `@open-codesign/providers` even though the same module was already statically imported by the main bundle. The dynamic import could not create a chunk, so `filterActive` and `formatSkillsForPrompt` are now static imports and only the skill loader remains lazy.
- Local ignored `docs/v0.2-plan.md` had stale tool-surface rows that still said `read-url` should be kept and `list-files` only maybe cut later. Updated it to match the current default tool surface and host-prefetched Reference URL flow.
- Follow-up security review tightened the untrusted context helper itself: the wrapper body was escaped, but the exported helper did not escape the wrapper `type` attribute or description text. Those fields are now escaped as well.
- Follow-up security review also constrained host-side reference URL prefetching to non-credentialed `http:` / `https:` URLs before calling `fetch`, so `file:` and embedded-credential URLs never enter the network path or prompt context.
- A later redirect-boundary review found that validating only the initial Reference URL was not enough because default fetch follows redirects automatically. Reference URL prefetching now handles redirects manually and validates every hop with the same HTTP(S) / no-credentials rules before following it.
- Size review found that electron-builder still packed source maps, declaration files, test/example/docs directories, and every Electron language resource into the app. The package config now prunes those non-runtime files and keeps only the locales supported by the app UI (`en-US`, `zh-CN`, `pt-BR`).
- Native-size review found that unpacked native modules still carried every `koffi` platform binary and all better-sqlite3 source plus fallback binaries. Added an `afterPack` prune hook that keeps only the current target's native binary set.
- Native-binding follow-up found an interaction between that prune hook and the v0.1 migration path: migration used a direct `better-sqlite3` constructor, which would look for the default `better_sqlite3.node` that package pruning removes. Migration now reuses the app's `native-binding` resolver, and the resolver has tests for Electron arch-specific and Node test ABI selection.

## Verification

- Passed: `pnpm --filter open-codesign-website build`
- Passed: `pnpm --filter @open-codesign/desktop exec electron-vite build`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/renderer/src/store.test.ts`
- Passed: `pnpm --filter @open-codesign/core test -- src/agent.test.ts`
- Passed: `pnpm --filter @open-codesign/core test -- src/agent.test.ts src/generate.test.ts`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/renderer/src/store.buildEnrichedPrompt.test.ts src/renderer/src/store.test.ts`
- Passed: `pnpm --filter @open-codesign/core test -- src/context-format.test.ts src/generate.test.ts src/agent.test.ts`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/generation-ipc.test.ts src/renderer/src/store.buildEnrichedPrompt.test.ts`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/generation-ipc.test.ts`
- Passed after cleanup: `rg` found no remaining `makeReadUrlTool` / `makeReadDesignSystemTool` / `makeListFilesTool` references.
- Passed after selected-element hardening: `pnpm --filter @open-codesign/core test -- src/context-format.test.ts src/generate.test.ts src/agent.test.ts`
- Passed: generated CSS scan for `space-1 5` / `space-0 5` / `space-2 5` in `apps/desktop/out` and `website/.vitepress/dist`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `pnpm typecheck`
- Passed: `pnpm test`
- Passed: `git diff --check`
- Passed after `view_range` EOF fix: `pnpm --filter @open-codesign/core test -- src/tools/text-editor.test.ts src/agent.test.ts src/generate.test.ts src/context-format.test.ts`
- Passed after `view_range` EOF fix: `pnpm --filter @open-codesign/core typecheck`
- Passed final full run: `pnpm build`
- Passed final full run: `pnpm typecheck`
- Passed final full run: `pnpm test`
- Passed final full run: `pnpm lint`
- Passed final full run: `git diff --check`
- Passed final full run: generated CSS scan for `space-1 5` / `space-0 5` / `space-2 5` in `apps/desktop/out` and `website/.vitepress/dist`
- Passed final static scan: no remaining `makeReadUrlTool` / `makeReadDesignSystemTool` / `makeListFilesTool` symbols outside deleted files/lock exclusions
- Passed final static scan: no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
- Passed after prompt/metadata follow-up: `pnpm install --frozen-lockfile`
- Passed after prompt/metadata follow-up: `pnpm --filter @open-codesign/core test -- src/agent.test.ts src/tools/text-editor.test.ts`
- Passed after prompt/metadata follow-up: `pnpm --filter @open-codesign/core typecheck`
- Passed after prompt/metadata follow-up: `pnpm build`
- Passed after prompt/metadata follow-up: `pnpm typecheck`
- Passed after prompt/metadata follow-up: `pnpm test`
- Passed after prompt/metadata follow-up: `pnpm lint`
- Passed after prompt/metadata follow-up: `git diff --check`
- Passed after prompt/metadata follow-up: generated CSS scan for `space-1 5` / `space-0 5` / `space-2 5` in `apps/desktop/out` and `website/.vitepress/dist`
- Passed after prompt/metadata follow-up: no remaining `makeReadUrlTool` / `makeReadDesignSystemTool` / `makeListFilesTool` symbols outside deleted files/lock exclusions
- Passed after prompt/metadata follow-up: no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
- Passed after packaging-root follow-up: `pnpm --filter @open-codesign/desktop build:dir`
- Passed after packaging-root follow-up: `pnpm build`
- Passed after packaging-root follow-up: `pnpm typecheck`
- Passed after packaging-root follow-up: `pnpm test`
- Passed after packaging-root follow-up: `pnpm lint`
- Passed after packaging-root follow-up: `git diff --check`
- Passed after packaging-root follow-up: generated desktop build scan found no remaining `@open-codesign/*` imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
- Passed after packaging-root follow-up: generated CSS scan for `space-1 5` / `space-0 5` / `space-2 5` in `apps/desktop/out` and `website/.vitepress/dist`
- Passed after packaging-root follow-up: lockfile scan shows `@xmldom/xmldom@<0.8.13` pinned to `0.8.13` and no `0.9.10` entry
- Passed after dynamic-import cleanup: `pnpm --filter @open-codesign/core test -- src/agent.test.ts src/tools/text-editor.test.ts`
- Passed after dynamic-import cleanup: `pnpm --filter @open-codesign/core typecheck`
- Passed after dynamic-import cleanup: `pnpm --filter @open-codesign/desktop exec electron-vite build` with no Vite dynamic-import warning
- Passed after dynamic-import cleanup: `pnpm --filter @open-codesign/desktop build:dir`
- Passed after dynamic-import cleanup: `pnpm build`
- Passed after dynamic-import cleanup: `pnpm typecheck`
- Passed after dynamic-import cleanup: `pnpm test`
- Passed after dynamic-import cleanup: `pnpm lint`
- Passed after dynamic-import cleanup: `git diff --check`
- Passed after dynamic-import cleanup: generated desktop build scan found no remaining `@open-codesign/*` imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
- Passed after dynamic-import cleanup: generated build scan found no remaining dynamic-import warning text
- Passed after dynamic-import cleanup: generated CSS scan for `space-1 5` / `space-0 5` / `space-2 5` in `apps/desktop/out` and `website/.vitepress/dist`
- Passed after untrusted-context metadata hardening: `pnpm --filter @open-codesign/core test -- src/context-format.test.ts`
- Passed after untrusted-context metadata hardening: `pnpm --filter @open-codesign/core typecheck`
- Passed after reference URL guard: `pnpm --filter @open-codesign/desktop test -- src/main/prompt-context.test.ts`
- Passed after reference URL guard: `pnpm --filter @open-codesign/desktop typecheck`
- Passed final follow-up run: `pnpm install --frozen-lockfile`
- Passed final follow-up run: `pnpm build`
- Passed final follow-up run: `pnpm typecheck`
- Passed final follow-up run: `pnpm test`
- Passed final follow-up run: `pnpm lint`
- Passed final follow-up run: `pnpm --filter @open-codesign/desktop build:dir`
- Passed final follow-up run: `git diff --check`
- Passed final follow-up scan: no generated `@open-codesign/*` imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
- Passed final follow-up scan: no generated dynamic-import warning text
- Passed final follow-up scan: no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
- Passed final follow-up scan: no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
- Passed final follow-up scan: `@xmldom/xmldom@<0.8.13` resolves to `0.8.13`, with no `0.9.10` lockfile entry
- Measured package smoke output before size pruning: `release/mac-arm64/Open CoDesign.app` 431M, `app.asar` 127M, `app.asar.unpacked` 47M.
- Measured package smoke output after size pruning: `release/mac-arm64/Open CoDesign.app` 334M, `Contents/Frameworks` 209M, `Contents/Resources` 125M, `app.asar` 75M, `app.asar.unpacked` 47M.
- Measured package smoke output after native pruning: `release/mac-arm64/Open CoDesign.app` 292M, `Contents/Frameworks` 209M, `Contents/Resources` 82M, `app.asar` 75M, `app.asar.unpacked` 4.6M.
- Passed after size-pruning follow-up: `pnpm --filter @open-codesign/desktop build:dir`
- Passed after size-pruning follow-up: `pnpm lint`
- Passed after size-pruning follow-up: `git diff --check`
- Passed after size-pruning follow-up: generated desktop build scan found no remaining `@open-codesign/*` imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
- Passed after size-pruning follow-up: generated build scan found no remaining dynamic-import warning text
- Passed after size-pruning follow-up: generated CSS scan for `space-1 5` / `space-0 5` / `space-2 5`
- Passed after size-pruning follow-up: no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
- Passed after native-pruning test follow-up: `pnpm --filter @open-codesign/desktop test -- scripts/after-pack-prune.test.mjs`
- Passed after native-pruning test follow-up: `pnpm lint`
- Passed after native-pruning test follow-up: `git diff --check`
- Passed final post-test-hook run: `pnpm typecheck`
- Passed final post-test-hook run: `pnpm test` (`@open-codesign/desktop`: 80 files, 1151 tests)
- Passed final post-test-hook run: `pnpm lint`
- Passed after Reference URL redirect hardening: `pnpm --filter @open-codesign/desktop test -- src/main/prompt-context.test.ts` (11 tests)
- Passed after Reference URL redirect hardening: `pnpm --filter @open-codesign/desktop typecheck`
- Passed after Reference URL redirect hardening: `pnpm lint`
- Passed after Reference URL redirect hardening: `git diff --check`
- Passed final redirect follow-up run: `pnpm build`
- Passed final redirect follow-up run: `pnpm test` (`@open-codesign/desktop`: 80 files, 1154 tests)
- Passed final redirect follow-up scan: no generated `@open-codesign/*` imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
- Passed final redirect follow-up scan: no generated dynamic-import warning text
- Passed final redirect follow-up scan: no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
- Passed final redirect follow-up scan: no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
- Passed after native-binding migration fix: `pnpm --filter @open-codesign/desktop test -- src/main/db/native-binding.test.ts src/main/migration/v01-to-v02.test.ts`
- Passed after native-binding migration fix: `pnpm --filter @open-codesign/desktop typecheck`
- Passed after native-binding migration fix: `pnpm lint`
- Passed after native-binding migration fix: `git diff --check`
- Earlier partial: full `pnpm build` originally passed website + desktop Vite compilation, then spent more than 9 minutes in electron-builder directory scanning with high CPU and no new logs. Root fix was to move installer packaging out of the ordinary desktop `build` script and keep it in `package` / `release`.

## Continuation Notes

- Rechecked the live worktree after handoff. The currently dirty tracked diff is focused on desktop packaging/build alignment, Reference URL validation, generation in-flight cleanup, migration/native-binding compatibility, renderer test noise, and UI token aliases. The core prompt/tool behavior described above is already present in the current branch; only additional core regression tests are untracked in this continuation.
- Removed the exploratory `apps/desktop/release-stage-test` directory that caused Biome to lint generated staged package files.
- Reformatted `apps/desktop/electron.vite.config.ts` with Biome after the cleanup.
- Re-polled the already-running full checks from the previous pass:
  - `pnpm typecheck`: passed, 10/10 tasks.
  - `pnpm test`: passed, 10/10 tasks; desktop reported 81 test files and 1159 tests.
- Fresh continuation checks:
  - `pnpm lint`: passed, 454 files checked.
  - `git diff --check`: passed.
  - `pnpm install --frozen-lockfile`: passed; lockfile was up to date and the desktop sqlite binding postinstall skipped because binaries were current.
  - `pnpm build`: passed; desktop build used Vite 7.3.2 and stayed on the Vite compilation path.
  - `pnpm typecheck`: passed, 10/10 tasks.
  - `pnpm test`: passed, 10/10 tasks; desktop reported 81 test files and 1159 tests.
  - `pnpm --filter @open-codesign/desktop build:dir`: passed through electron-builder dependency search, packaging, signing, and afterPack pruning.
  - Static scans passed: no stale `anti-slop.md` in `out/main`; no generated `@open-codesign/*` runtime imports; no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS; no generated dynamic-import warning text; no direct app/package imports of forbidden provider SDKs; no bad `@xmldom/xmldom` override or `0.9.x` lock entry.
- Final package smoke size sample: `Open CoDesign.app` 252M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Second Review Pass

- Expanded review scope from the uncommitted working tree to the full local branch delta against `origin/dev/v0.2`, because local `HEAD` already contains `refactor: make codesign prompts manifest-first`.
- Fixed `withInFlightGeneration` to delete an in-flight controller only when the map still points at that exact controller. This prevents an old request with a reused generation id from clearing a newer controller.
- Made `after-pack-prune.cjs` fail-fast when a packaged `better-sqlite3` module lacks the target Electron arch binary. A missing native binding now fails packaging instead of becoming a startup-time database crash.
- Replaced the v0.1 chat migration's `as never` message append with explicit pi-compatible legacy user/assistant message materialization, including zero usage metadata for legacy assistant rows.
- Removed a model-visible false instruction from the `skill` tool: not-found responses no longer tell the model to call unsupported `skill('__list__')`.
- Fixed the upgrade path for manifest-first skills/scaffolds: `ensureUserTemplates` now copies missing bundled template files into an existing user-owned templates directory without overwriting existing files. This keeps newly bundled skills available after upgrades while preserving user edits.
- Third review pass found and fixed a remaining Reference URL SSRF/local probing gap: HTTP(S) URLs and every redirect hop now reject localhost, `.localhost`, `.local`, private/link-local/reserved IP literals, IPv4-mapped IPv6 literals, and hostnames whose DNS results include blocked addresses before fetch.
- Fourth review pass tightened the same Reference URL boundary further: DNS resolution now uses the generation timeout signal, and reserved/documentation IPv4 ranges are blocked along with private and link-local ranges.
- Fifth review pass closed the connection-time DNS rebinding gap in Reference URL prefetching: the default fetcher now uses Node `http`/`https` with a custom `lookup` that reuses the same blocked-address validation during the actual socket lookup instead of relying on preflight DNS alone.
- Sixth review pass found and fixed a workspace-path root bug: empty or relative workspace paths were silently resolved against the current process directory. Workspace binding and low-level workspace updates now reject those values, and stored workspace paths are revalidated before file reads/writes so corrupt DB rows cannot write relative to the app cwd.
- Seventh review pass tightened the same boundary across platforms: Windows drive paths are now rejected on macOS/Linux instead of being treated as cwd-relative strings, Windows-only path normalization is isolated in a helper, and runtime/IPC code imports the helper without pulling in Electron workspace UI dependencies.
- Eighth review pass removed a remaining pseudo-success path in `codesign:files:v1:list`: missing designs, unbound workspaces, and corrupt stored workspace paths now throw typed IPC errors instead of returning `[]` and masquerading as an empty folder.
- Ninth review pass removed the matching pseudo-success path in `codesign:files:v1:subscribe`: missing designs, unbound workspaces, corrupt stored paths, and watcher startup failures now throw typed IPC errors. Existing watchers are restarted when the bound workspace path changes, and the renderer hook now keys fetch/subscribe behavior on the live workspace binding instead of only the design id.
- Ninth review pass also fixed two verification-discovered gaps: `skills/loader.ts` was still pulled into the main bundle through static exports/imports despite the manifest path trying to lazy-load it, and `GENERATION_INCOMPLETE` lacked locale entries in the i18n error table.
- Third review pass made `str_replace_based_edit_tool` fail fast on missing command-specific fields instead of silently defaulting `file_text`, `new_str`, or `insert_line`; runtime `insert` now requires an existing file instead of creating a new file through the wrong command.
- Third review pass fixed v0.1 migration data loss and cleanup hazards: inline comments are migrated into the pi session timeline, the legacy DB is closed before backup rename, existing backup names get a unique suffix, optional missing `comments` tables do not fail older migrations, and legacy file paths are validated before workspace directories are created.
- Fourth review pass removed the Electron native-binding default fallback: missing target Electron better-sqlite3 binaries now fail before DB open instead of falling through to a possibly Node-ABI `better_sqlite3.node`; the postinstall script now requires the Node ABI binary for local test/runtime use.
- Targeted checks passed after the second pass:
  - `pnpm --filter @open-codesign/desktop test -- scripts/after-pack-prune.test.mjs src/main/generation-ipc.test.ts`
  - `pnpm --filter @open-codesign/desktop test -- src/main/migration/v01-to-v02.test.ts src/main/db/native-binding.test.ts`
  - `pnpm --filter @open-codesign/core test -- src/tools/skill.test.ts`
  - `pnpm --filter @open-codesign/desktop test -- src/main/ensure-user-templates.test.ts`
  - `pnpm --filter @open-codesign/core test -- src/tools/skill.test.ts src/tools/scaffold.test.ts`
- Targeted checks passed after the third pass:
  - `pnpm --filter @open-codesign/desktop test -- src/main/prompt-context.test.ts`
  - `pnpm --filter @open-codesign/core test -- src/tools/text-editor.test.ts`
  - `pnpm --filter @open-codesign/desktop test -- src/main/index.workspace.test.ts`
  - `pnpm --filter @open-codesign/desktop test -- src/main/migration/v01-to-v02.test.ts`
  - `pnpm --filter @open-codesign/desktop typecheck`
  - `pnpm lint`
- Targeted checks passed after the fourth pass:
  - `pnpm --filter @open-codesign/desktop exec node scripts/install-sqlite-bindings.cjs`
  - `pnpm --filter @open-codesign/desktop test -- src/main/prompt-context.test.ts src/main/db/native-binding.test.ts`
  - `pnpm --filter @open-codesign/desktop test -- src/main/db/native-binding.test.ts src/main/migration/v01-to-v02.test.ts`
  - `pnpm --filter @open-codesign/desktop typecheck`
  - `pnpm lint`
- Final second-pass full checks:
  - `pnpm lint`: passed, 454 files checked.
  - `pnpm typecheck`: passed, 10/10 tasks.
  - `pnpm test`: passed, 10/10 tasks; desktop reported 81 test files and 1162 tests.
  - `pnpm --filter @open-codesign/desktop build:dir`: passed through Vite build, electron-builder packaging, ad-hoc signing, and afterPack pruning.
  - `pnpm test:e2e`: not available; pnpm returned `Command "test:e2e" not found`.
  - `git diff --check`: passed.
  - Static scans passed: no stale `anti-slop.md` in `out/main`; no generated `@open-codesign/*` runtime imports; no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS; no generated dynamic-import warning text; no direct app/package imports of forbidden provider SDKs; no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry; no source `skill('__list__')` guidance remains outside the regression assertion.
  - Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Third Review Final Verification

- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm lint` (454 files checked)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1170 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- Source scan note: old tool names remain only in renderer history-label compatibility and regression assertions, not in the core agent tool surface.
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Tenth Review Final Verification

- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm lint` (461 files checked)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1200 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Tenth Review Pass

- Enforced the v0.2 "every design has a workspace" contract at product boundaries:
  - `snapshots:v1:create-design` now creates or accepts a workspace in the same create flow, hides the row and throws a typed error if binding fails, and no longer returns visible workspace-less designs.
  - `snapshots:v1:workspace:update` rejects `workspacePath: null` so product IPC cannot clear a design back into a workspace-less state.
  - Renderer create flow passes the selected workspace path directly into create-design instead of creating first and rebinding later.
  - The Files panel no longer exposes a clear-workspace action; null workspace display text is now explicitly legacy/unbound.
- Closed workspace-less persistence paths:
  - Chat JSONL session operations reject unbound legacy designs instead of falling back to Documents.
  - Runtime filesystem writes reject persisted designs whose workspace path is null instead of writing only to `design_files`.
  - The stale `defaultCwd` option was removed from session-chat options to keep the old fallback from being reintroduced accidentally.
- Made duplicate-design product semantics workspace-real:
  - The low-level DB helper clones `design_files` mirror rows while still leaving `workspace_path` null for the product IPC to bind.
  - Product duplicate now requires the source design to be workspace-backed, copies tracked workspace files into the newly allocated workspace, binds the clone, and hides the clone on copy/bind failure.
- Made generation workspace-bound end to end:
  - `GeneratePayloadV1` now requires `designId`; missing design ids fail schema validation.
  - Renderer `sendPrompt` refuses to start without a current workspace-backed design and shows `WORKSPACE_MISSING`.
  - Main-process generation requires a resolved bound workspace before prompt context, resource state, preview, and runtime tools are created; there is no more "run without workspace reader" pseudo-success path.
  - Added shared error-code and localized `WORKSPACE_MISSING` copy for en, zh-CN, and pt-BR.
- Eleventh review pass found a symlink traversal gap in workspace-relative paths:
  - Single-file workspace reads now reject paths that traverse symlinked workspace segments.
  - Product file writes, runtime edit-tool write-through, and duplicate/migrate tracked-file copies all reuse the same safe path resolver.
  - Renderer file listing now surfaces list IPC failures with a toast instead of silently presenting an empty folder.
- Targeted checks passed during this pass:
  - `pnpm --filter @open-codesign/desktop test -- src/main/snapshots-ipc.test.ts src/main/design-workspace.test.ts src/main/snapshots-db.test.ts src/main/index.workspace.test.ts src/renderer/src/store.test.ts src/renderer/src/components/FilesPanel.test.tsx` (288 tests)
  - `pnpm --filter @open-codesign/desktop typecheck`
  - `pnpm lint`
  - `pnpm --filter @open-codesign/i18n test`
  - `pnpm --filter @open-codesign/shared test -- src/generate-payload.test.ts src/error-codes.test.ts`
  - `pnpm --filter @open-codesign/desktop test -- src/main/workspace-reader.test.ts src/main/snapshots-ipc.test.ts src/main/index.workspace.test.ts src/main/design-workspace.test.ts src/renderer/src/store.test.ts` (244 tests)

## Eighth Review Final Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/snapshots-ipc.test.ts src/renderer/src/components/FilesPanel.test.tsx` (142 tests)
- Passed: `pnpm --filter @open-codesign/desktop typecheck`
- Passed: `pnpm lint` (455 files checked)
- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1186 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Ninth Review Final Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/workspace-watcher.test.ts src/renderer/src/components/FilesPanel.test.tsx` (42 tests)
- Passed: `pnpm --filter @open-codesign/desktop typecheck`
- Passed: `pnpm --filter @open-codesign/core test -- src/tools/skill.test.ts src/resource-manifest.test.ts src/agent.test.ts src/generate.test.ts` (87 tests)
- Passed: `pnpm --filter @open-codesign/core typecheck`
- Passed: `pnpm --filter @open-codesign/i18n test` (13 tests)
- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`; the previous `dynamic import will not move module` warning for `skills/loader.ts` is gone and the build now emits a separate `loader` chunk.
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm lint` (461 files checked)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1191 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Seventh Review Final Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/design-workspace.test.ts src/main/snapshots-db.test.ts src/main/index.workspace.test.ts src/main/snapshots-ipc.test.ts` (190 tests)
- Passed: `pnpm --filter @open-codesign/desktop typecheck`
- Passed: `pnpm lint` (455 files checked)
- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1182 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Sixth Review Final Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/design-workspace.test.ts src/main/snapshots-db.test.ts src/main/index.workspace.test.ts src/main/snapshots-ipc.test.ts` (188 tests)
- Passed: `pnpm --filter @open-codesign/desktop typecheck`
- Passed: `pnpm lint` (454 files checked)
- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1180 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Fifth Review Final Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/prompt-context.test.ts` (16 tests)
- Passed: `pnpm --filter @open-codesign/desktop typecheck`
- Passed: `pnpm lint` (454 files checked)
- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1175 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Fourth Review Final Verification

- Passed: `pnpm install --frozen-lockfile`
- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm lint` (454 files checked)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1174 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Eleventh Review Final Verification

- Passed: `pnpm build`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm lint` (461 files checked)
- Passed: `pnpm test` (10/10 tasks; desktop reported 81 test files and 1204 tests)
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.

## Twelfth Review Pass

- Rechecked the create/duplicate failure paths for v0.2's "every design has a workspace" invariant.
- Fixed a remaining rollback leak: when the app auto-created `<Documents>/CoDesign/<slug>` and a later bind/copy step failed, the directory remained on disk. Rollback now removes only the auto-created workspace for that operation; caller-provided workspaces are never removed.
- Fixed the matching DB atomicity issue: failed create/duplicate rollbacks now hard-delete the incomplete design row so cloned snapshots, messages, comments, and `design_files` cascade away instead of lingering behind a hidden soft-deleted design.
- Added regression coverage for default-workspace bind failure, caller-provided workspace preservation, clone bind failure, and clone file-copy failure.

## Twelfth Review Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/snapshots-ipc.test.ts`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/snapshots-ipc.test.ts src/main/snapshots-db.test.ts` (172 tests)

## Thirteenth Review Pass

- Extended the workspace-path audit from the main file IPC write paths to adjacent agent/runtime surfaces.
- Fixed generation workspace resolution so stored DB paths are normalized and corrupt values fail before prompt context, workspace scans, preview, or runtime tools receive a cwd.
- Fixed session JSONL access to reject corrupt stored workspace paths before opening the pi session manager.
- Tightened workspace binding so new bindings must target an existing directory, and product IPC maps missing/non-directory paths to input errors.
- Hardened scaffold, skill, brand-reference, frame-template, design-skill, project-context, and preview source reads against symlink traversal.
- Added preview request interception for `file://` asset loads so rendered previews cannot load workspace-outside assets through symlinked paths.

## Thirteenth Review Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/generation-workspace.test.ts src/main/prompt-context.test.ts src/main/preview-runtime.test.ts`
- Passed: `pnpm --filter @open-codesign/core test -- src/tools/scaffold.test.ts`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/design-workspace.test.ts src/main/snapshots-ipc.test.ts src/main/generation-workspace.test.ts`
- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/snapshots-ipc.test.ts src/main/design-workspace.test.ts src/main/generation-workspace.test.ts src/main/prompt-context.test.ts src/main/preview-runtime.test.ts`
- Passed: `pnpm --filter @open-codesign/core test -- src/tools/skill.test.ts src/tools/scaffold.test.ts`
- Passed: `pnpm --filter @open-codesign/core test -- src/design-skills/index.test.ts src/agent.test.ts src/tools/skill.test.ts src/tools/scaffold.test.ts`
- Passed: `pnpm typecheck` (10/10 tasks)

## Fourteenth Review Pass

- Final typecheck exposed a stale `done-verify.test.ts` import for `formatRuntimeLoadError`.
- Restored the explicit formatter export and routed `did-fail-load` messages through it so large self-contained `data:` srcdoc URLs are redacted instead of stored or surfaced in full.

## Fourteenth Review Final Verification

- Passed: `pnpm --filter @open-codesign/desktop test -- src/main/done-verify.test.ts`
- Passed: `pnpm typecheck` (10/10 tasks)
- Passed: `pnpm lint` (464 files checked)
- Passed: `pnpm test` (10/10 tasks; desktop reported 83 test files and 1217 tests)
- Passed: `pnpm build`
- Passed: `pnpm --filter @open-codesign/desktop build:dir`
- Passed: `git diff --check`
- Passed static scans:
  - no stale `anti-slop.md` in `apps/desktop/out/main`
  - no generated `@open-codesign/*` runtime imports in `apps/desktop/out/main`, `out/preload`, or `out/renderer`
  - no generated invalid `space-1 5` / `space-0 5` / `space-2 5` CSS
  - no generated dynamic-import warning text
  - no direct app/package imports of `@anthropic-ai/sdk`, `openai`, or `@google/genai`
  - no bad `@xmldom/xmldom` override or `0.9.x` lockfile entry
- `pnpm test:e2e`: still not available; pnpm returned `Command "test:e2e" not found`.
- Final package smoke size sample: `Open CoDesign.app` 251M, `Contents/Frameworks` 209M, `Contents/Resources` 42M, `app.asar` 38M, `app.asar.unpacked` 1.9M.
