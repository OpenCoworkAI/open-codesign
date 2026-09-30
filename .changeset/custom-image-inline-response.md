---
"@open-codesign/providers": patch
"@open-codesign/desktop": patch
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
---

Add an opt-in base64 response setting for OpenAI-compatible image gateways so generated assets can be saved locally. Keep existing and strict GPT image requests unchanged by default, and reset the compatibility setting when switching image providers.
