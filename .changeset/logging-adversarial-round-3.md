---
'@open-codesign/desktop': patch
'@open-codesign/shared': patch
'@open-codesign/i18n': patch
'@open-codesign/providers': patch
---

fix: 3-reviewer adversarial round — privacy, UX, correctness

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
