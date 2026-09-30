---
"@open-codesign/desktop": patch
"@open-codesign/shared": patch
"@open-codesign/providers": patch
"@open-codesign/i18n": patch
---

Make connection tests validate the real generate invoke contract (shared provider resolution, auth, baseUrl, and wire) instead of treating GET /models as a stand-in for runtime.
