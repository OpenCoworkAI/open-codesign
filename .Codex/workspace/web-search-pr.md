## Summary

Add opt-in Web Search v1 for research-backed slide decks: search and read public references, save evidence while working, associate it with stable slide IDs, and generate an independent Markdown sources document through normal exports. Slides do **not** get source footers, citation numbers, chart source captions, or a references page by default.

**Draft for scope and architecture review.** This is a larger first-version change (40 files, including tests and documentation), not a request to bypass the project's small-PR preference. The supporting startup fix is isolated in its own commit and can be split/cherry-picked if preferred.

## Type of change

- [x] New feature
- [x] Bug fix
- [x] Documentation
- [ ] Refactor (no behavior change)
- [ ] Build / CI / tooling
- [ ] Breaking change

## Linked issue

Refs #432 — [Opt-in web research for slides with independent source documents](https://github.com/OpenCoworkAI/open-codesign/issues/432).

## Implementation

- Register `web_search`, `web_fetch`, and small research-record/evidence/slide/export tools through the existing manifest and final model-visible tool list. No agent-loop rewrite or MCP framework.
- Use one provider-independent Tavily search adapter; main-process service owns credentials and HTTP requests. Distinguish disabled, missing credentials, empty results, service failures, timeouts, cancellation, and budget exhaustion.
- Protect direct page reading with public HTTP(S)-only URLs, DNS validation and socket pinning, per-redirect checks, bounded body/output sizes, and abort propagation. External content is reference data, not instructions.
- Persist schema-versioned sources/evidence/usage in `.codesign/research.json` using the existing workspace writer lock and atomic replacement. Reject dangling IDs and quotations not present in saved excerpts; mark reading separately from fact verification.
- Use `data-slide-id` and rendered semantic fingerprints rather than page numbers. Reorder/deletion follows current DOM order; changed content yields evidence gaps instead of old supporting links. Styling-only changes such as color/font changes retain evidence.
- Generate collision-safe workspace Markdown and companion files beside normal exports or inside ZIPs. Include only used evidence plus calculation inputs; leave user-authored files and the slides themselves untouched.
- Preserve opt-in and limits through provider/model changes, imports and settings saves. Use the registered ask IPC/AskModal consent path with explicit per-run allow/deny and the upstream design/run recovery scope.
- Isolate unreadable credential migrations so an optional malformed key does not block opening Settings; preserve failed entries and keep strict decryption on use.

## Configuration and usage

See [`WEB_SEARCH.md`](WEB_SEARCH.md). With the app closed, add/update the active local config:

```toml
[webSearch]
enabled = true
maxCalls = 12
timeoutMs = 15000
maxChars = 10000

[secrets.tavily]
ciphertext = "plain:YOUR_TAVILY_API_KEY"
```

Restart, submit a research-backed slide request, and approve **Allow this run** when prompted. The key is never a tool parameter or renderer-facing setting. Feature remains disabled by default; configuring a key alone does not enable networking.

## Validation

Rebased onto upstream `ed5fed9` (v0.2.2-era main) and adapted research consent to the new persisted question/run scope. The normal pre-commit and pre-push hooks were used, not bypassed.

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm -r typecheck` (normal pre-push hook) | Pass across the workspace |
| `pnpm test` | 3,257 Vitest tests passed, 4 skipped; 61 CI-tool script tests passed |
| `pnpm --filter @open-codesign/desktop build` | Pass after rebase |
| Focused question recovery, consent, cancellation and research integration after rebase | 74 tests passed |
| Public patch scope, sensitive-pattern scan and `git diff --check` | Pass |

Local validation environment: Windows, Node **24.11.1**, pnpm **10.33.4**, installed system browser. The repository pins Node 22; a separate Node 22 local run and installer packaging were not performed. CI and maintainer review are still required.

Commits:
- `21ddaf1` — keep unreadable credentials from blocking startup (independently reviewable supporting fix).
- `198731c` — opt-in web research and slide source exports.

Automated integration uses mocked search/fetch responses but real system-browser HTML/JSX rendering and ZIP output, including record recovery, page reorder/deletion, visual-only changes without repeat searches, stale evidence, nested asset paths, and concurrent workspace writes. Network-boundary tests cover normalization, missing fields, private/metadata/mapped IPs, pinned DNS, redirects, budgets, failure, timeout, cancellation, and output limits.

A local tester reports successful Tavily search and basic slide usage. I have not independently run a comprehensive real-provider/autonomous-live-model E2E or tested every target OS. No credentials, private workspace records, generated artifacts, or local validation logs are included.

## First-version limits

- One search provider; no fallback/deep research, no PDF, authenticated or JavaScript-only article reading; direct page reader does not use proxies.
- Research snapshots reuse an installed system browser. Text/SVG charts are supported; canvas/iframe/video research slides are rejected. Every slide section needs a stable ID.
- Fingerprints are deliberately conservative: SVG geometry or image URL changes may require relinking even for a visual edit; arbitrary CSS-generated content and remote image bytes changing at the same URL are not semantically verified.
- Natural-language offline instructions are in the agent guidance; the host-enforced gate is config opt-in plus explicit per-run consent. Source extraction and quote matching are not fact certification.
- Previously exported Markdown is a snapshot; current-order sources are regenerated on the next export.

## Compatibility / upgradeability / lean / clarity

- [x] Compatibility: additive config fields and tool dependencies; existing designs without research remain usable; existing credentials/config settings are retained.
- [x] Upgradeability: versioned research file schema, reuse of current credential storage and native agent/export interfaces; changesets included, changelogs not edited.
- [x] Lean: **no new runtime dependency**, bundled browser/model/Python runtime, provider SDK, hosted service layer, or research panel.
- [x] Clarity: one adapter, a bounded main-process service, validated local records and deterministic export; no speculative provider/plugin registry.

## Checklist

- [x] Reviewed relevant project context and linked the feature proposal.
- [x] Added/updated meaningful tests.
- [x] Added changesets for user-visible behavior.
- [x] Updated documentation.
- [x] Local lint, typechecks, tests and desktop build pass (details and skips above).

## Screenshots / recordings

No new panel or visual layout is introduced. Consent reuses the existing question dialog, and companion-file paths use existing export notifications. No screenshot/recording is attached; this remains a draft.
