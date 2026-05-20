---
"@open-codesign/desktop": minor
"@open-codesign/i18n": patch
---

Add an HTTP proxy field to Settings → Advanced. The configured URL is applied to both Chromium's network stack and Node's HTTP(S)_PROXY env vars, takes effect immediately, and persists across restarts.
