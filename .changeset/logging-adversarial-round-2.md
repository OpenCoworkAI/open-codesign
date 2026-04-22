---
'@open-codesign/desktop': patch
'@open-codesign/shared': patch
'@open-codesign/i18n': patch
---

fix: adversarial review round 2 — close remaining CRITICAL / HIGH privacy gaps

A second adversarial review pass turned up three critical + four high-severity issues the first round missed. All fixed here.

**Privacy (CRITICAL):**
- Bundle's `main.log` was being zipped raw — completely bypassing the user's `includePromptText / includePaths / includeUrls` toggles. A user unchecking "Include paths" to protect `~/Users/name/...` still had those paths go verbatim to the public GitHub issue via the zipped log. Now every line of `main.log` in the bundle runs through the same per-line scrubber as `summary.md`. The generic "Export diagnostic bundle" button (no per-event toggles) defaults to redacting all three categories — safest choice.
- Report dialog's preview now honors the redaction toggles live. Previously the `<pre>` showed `event.message` verbatim regardless of toggle state, so users had no way to verify redaction. A new client-side `redact.ts` mirrors the main-process regexes exactly (all 3 branches of `scrubPromptInLine`), and the preview re-runs on every toggle change. Provider-scope events now also display an "Upstream context" block (provider, status, request-id, retry count, redacted body head) — previously the body head was posted publicly without ever being shown to the reporter.
- Path redaction regex broadened to cover `/var/folders/...` (macOS tmp), `/tmp/...`, `/etc/...`, `/private/var/...`. These paths routinely appear in fs error messages and were leaking before.

**Correctness (HIGH):**
- `preferences-ipc.ts` schema migration 4→5 no longer seeds `diagnosticsLastReadTs` to `0`. Upgrading users were getting a "99+" unread badge on first launch (every historical error row counted as unread). Now the migration seeds to `Date.now()` — fresh installs still start at 0 because the DB is empty too.
- `providerContext` store no longer evicts an unrelated run's context when a second `provider.error` event arrives for an already-tracked run.
- `writeAtomic` now unlinks its tmp file on write/rename failure, and a `cleanupStaleTmps` sweep on boot removes litter left by crashed processes.
