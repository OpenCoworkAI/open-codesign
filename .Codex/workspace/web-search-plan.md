# Web Search v1

## Findings
- Live runtime is pi-agent-core Agent; tools execute(callId, params, signal), content+details, existing lifecycle events. Manifest filters final list.
- Main creates per-run dependencies in ipc/generate.ts. Config v3 secrets map + main credentials resolver; no need for UI or MCP.
- Workspace source is authoritative; current slides sections have no common stable ID. Adopt data-slide-id and validate rendered content fingerprints; resolve page order at export.
- Existing export IPC supports file save. Reuse it to save collision-safe companion sources Markdown next to each export. JSX render uses existing lazy exporter runtime.

## Plan
1. Network service: Tavily adapter, normalized sources, secure HTTP fetch, budgets/abort/limits/tests (implemented directly; delegated work was stopped before starting).
2. Shared config, core tool contract and prompt, main injection and persistence.
3. Rendered slide identity/snapshots, saved evidence+usage, deterministic sources generation and export.
4. Integration tests, typecheck/lint, mocked end-to-end research flow incl reorder/style/delete/stale content.

## Expected files
- shared config.ts, tool-manifest.ts
- core tools/web-research.ts, agent.ts, tool-manifest.ts, index.ts, tests
- desktop main web-research*.ts, ipc/generate.ts, exporter-ipc.ts and tests
- exporters index.ts/rendered-html.ts (reuse lazy rendering)
- README or public focused guide + changeset

## Validation
Complete. No live Tavily API or autonomous live-model end-to-end run was executed.

Final validation after environment recovery:
- Core: 548 tests passed.
- Shared: 275 tests passed.
- Exporters: 90 passed, 3 existing skips.
- Desktop focused generation/OAuth/renderer/export/research suites: 193 passed.
- Total: 1,106 passed, 3 skipped.
- Shared, core, exporters and desktop (main + renderer) typechecks passed.
- Biome on all 24 changed/new TypeScript files passed; git diff --check passed.
- Desktop production build passed (not installer packaging).
- Mock research flow used real system-browser HTML/JSX rendering and a real ZIP: search/fetch, saved evidence, restored records, current-order source output, color change without new search, deletion and stale-content gaps.
- Final fixes verified: nested-deck relative assets use the same resolution as ordinary exports; research writes from multiple sessions use the existing workspace file lock without losing records.

Delivery: WEB_SEARCH.md, README link, changeset. Source companions are in the workspace and ordinary export destinations/ZIPs. No new runtime dependency, no source panel, and no modifications to the agent loop.
