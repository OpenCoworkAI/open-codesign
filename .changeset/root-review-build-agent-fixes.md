---
"@open-codesign/core": patch
"@open-codesign/desktop": patch
"@open-codesign/ui": patch
---

fix: align build, tool prompts, and model switcher token output

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
