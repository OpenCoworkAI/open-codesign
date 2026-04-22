---
'@open-codesign/desktop': minor
'@open-codesign/shared': patch
'@open-codesign/i18n': patch
---

fix: tighten Always Reportable architecture after 3-reviewer audit

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
