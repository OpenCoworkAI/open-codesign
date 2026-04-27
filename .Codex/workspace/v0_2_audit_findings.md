# v0.2 Audit Findings

## Initial Findings

- `docs/v0.2-final-report.md` already states v0.2 is not fully complete: T3 renderer integration, Processes panel, E2E, multi-fixture migration tests, and allowlist persistence are follow-ups.
- Need verify current code state because the report may be stale relative to this checkout.

## Verified Findings

- Current branch is `dev/v0.2`; it has follow-up commits after `docs/v0.2-final-report.md`, including `AskModal`, preview wiring, workspace watcher, and legacy-generate cleanup work.
- `ask` is now wired end-to-end enough to display `AskModal`: main bridge `ask-ipc.ts`, renderer component `AskModal.tsx`, and App mount are present.
- `preview` tool is now backed by `apps/desktop/src/main/preview-runtime.ts` and passed into `generateViaAgent` when a workspace is attached.
- Scaffolds/skills/brand refs exist under `apps/desktop/resources/templates`: 31 scaffold manifest entries, 9 skills, 25 brand refs.
- Process registry exists and tests pass, but no renderer `ProcessesPanel` or IPC surface was found; it is not user-visible.
- Permission dialog exists, but no concrete allowlist persistence implementation was found. `permission-ipc.ts` only resolves `once|always|deny`.
- The big architecture goal is not complete: SQLite still defines and uses `designs`, `design_snapshots`, `chat_messages`, `comments`, and `design_files`. The live generate path writes through the virtual FS/SQLite path, not a pure JSONL + workspace filesystem model.
- The live agent path uses `@mariozechner/pi-agent-core` with custom `text_editor/list_files/done/read_design_system` tools; the plan expected pi-coding-agent built-ins plus hook interception as the primary execution path.
- No Playwright E2E suite/config was found for the v0.2 golden path.

## Verification

- `pnpm --filter @open-codesign/core test -- --run agent-session tool-manifest tools/ask tools/scaffold tools/skill tools/preview tools/done security/bash-blocklist`: 8 files / 64 tests passed.
- `pnpm --filter @open-codesign/desktop test -- --run ask-ipc permission-ipc preview-runtime process-registry workspace-watcher migration/v01-to-v02 ensure-user-templates`: 7 files / 39 tests passed.
- `pnpm typecheck`: 10/10 package tasks passed.
