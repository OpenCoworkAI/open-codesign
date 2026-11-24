---
"@open-codesign/providers": patch
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
"@open-codesign/desktop": patch
---

Classify provider failures by recovery action and show localized next steps. Keep unsupported message roles distinct from unsupported gateways, preserve nested network error codes, and distinguish exhausted quota from rate limits.

Keep status and recovery identity through wrapped errors and durable generation events, including Electron's message-only rejections. Preserve scrubbed final diagnostic context without duplicate records; stop retrying exhausted account quota and give precise provider eligibility guidance.
