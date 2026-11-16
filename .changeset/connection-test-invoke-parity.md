---
"@open-codesign/desktop": patch
"@open-codesign/shared": patch
"@open-codesign/providers": patch
"@open-codesign/i18n": patch
---

Make connection tests validate the real generate invoke contract (shared provider resolution, auth, baseUrl, and wire) instead of treating GET /models as a stand-in for runtime.

Use a bounded saved-model inference with no automatic retries. Return explicit unverified results for adapters that cannot honor the small token budget, and reject unsupported query parameters instead of ignoring them. Bind ChatGPT OAuth to its official secure endpoint before accessing credentials and redact diagnostic URLs.
