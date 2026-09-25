REVIEW github-actions
**Findings**

- [Minor] Research guidance is injected even when no research tools exist — `packages/core/src/agent.ts:1216` builds `baseAgenticGuidance` by unconditionally prepending `WEB_RESEARCH_GUIDANCE`, while the tools are only registered under `if (deps.research)` (`packages/core/src/agent.ts:1194`) and `availableToolNames({ research: deps.research !== undefined, ... })`. Callers that omit `research` still receive a system prompt telling the model to put `data-slide-id` on every section and to call `research_export(path)` after the final page edits, which invites calls to tools that are not registered (and, on a plain deck, companion files made only of `Evidence gap` entries).
  Suggested fix: only prepend the block when `deps.research` is defined, and add a Vitest case asserting `WEB_RESEARCH_GUIDANCE` text is absent from `state.systemPrompt` when `research` is not passed.

- [Minor] A companion-file failure now aborts the primary export — `apps/desktop/src/main/exporter-ipc.ts:260` awaits `prepareResearchExport(resolved)` before `exportArtifact` with no guard. That path runs `readResearchSlides` (`RESEARCH_SLIDES_SCRIPT` throws on canvas/iframe/video slides, on a section without a unique `data-slide-id`, and on a deck that failed to render) and `loadResearchStore` (throws on a malformed `.codesign/research.json`). A design that exported fine before can now fail HTML/PDF/PPTX/ZIP/Markdown export entirely because of optional research metadata, with an error worded for research slides rather than for the export the user requested.
  Suggested fix: catch companion-generation errors, keep the export result, and append the message to `researchWarnings` so it is still surfaced in the existing export toast; or only hard-fail when the user explicitly asked for a sources file.

- [Nit] `research_records` writes the file it only reads — `apps/desktop/src/main/web-research.ts:120` routes `readRecords` through `transaction()`, which always calls `saveResearchStore`, so a read-only `research_records` call rewrites (and creates, when absent) `.codesign/research.json`.
  Suggested fix: add a read-only host path that skips `saveResearchStore` when nothing changed.

**Questions**

- Was every remaining `writeConfig` call site that builds a fresh `Config` literal audited for `webSearch` preservation? The diff covers provider CRUD, Codex OAuth, external imports, image settings, design-system saves and onboarding reset, and `apps/desktop/src/main/onboarding-ipc.test.ts` exercises those. Any unaudited save path that still rebuilds the config would silently drop the opt-in and limits on the next ordinary save.

**Summary**

- Review mode: initial. No blockers found; the two Minor items above are the only material concerns, and both are conditional on the research feature being in use.
- Scope and constraints: the change is additive and offline-safe by default. `parse5` is imported lazily inside `readableHtml` (`apps/desktop/src/main/web-research-network.ts`), so startup does not load it; `packages/exporters/src/index.ts:18` lazy-imports the slide reader. New deps are permissive (parse5 8.0.1 MIT, `entities` 8.1.0 BSD-2-Clause) and `pnpm-lock.yaml` records `entities` engines `node >=20.19.0`, compatible with `package.json` engines `node >=22`. No provider SDK imports were added; LLM calls still route through the existing agent path.
- Security posture looks sound from the diff: public HTTP(S) only on ports 80/443, no embedded credentials, reserved/private/loopback/link-local/CGNAT/IPv4-mapped IPv6 ranges blocked, all DNS answers validated before connect, the socket pinned to the validated address, every redirect re-validated, 1 MiB body cap, redirect cap, per-run call budget, timeout and cancellation, and sanitized error messages that do not echo the API key. HTML is parsed as untrusted text, never inserted as markup. Consent is genuinely host-enforced through the existing ask IPC and is per-run (`apps/desktop/src/main/web-research.ts:96`).
- Credential-migration change is consistent with the no-silent-fallback rule: unreadable entries are preserved with a credential-free log line, and `decryptSecret` still fails strictly on use `(apps/desktop/src/main/keychain.ts:96`. Error-message narrowing in `decryptSafeStorage` is guidance-only.
- The linked issue is referenced as `Refs #432`, which is the correct form for a partial/first slice; no closure claim needed validating. Changesets cover the four affected packages, docs and README were updated, and no release/packaging/distribution files are touched, so there is no checksum/manifest path to verify.
- Residual risk: the PR body states live Tavily and a live-model autonomous E2E were not run in that session, and I could not independently verify the reported CI/CodeQL results from this diff. Windows-first validation plus a pinned Node 22 run remains a gap the author already flags.

**Testing**

- Not run (automation). Suggested additions: a Vitest assertion that the research guidance and `data-slide-id` instructions are absent when `deps.research` is undefined; a test that a corrupt `.codesign/research.json` or a non-conforming deck does not fail the primary export (or that the failure is surfaced through `researchWarnings`); and a test that `research_records` does not create or rewrite `.codesign/research.json`.

*Open-CoDesign Bot*