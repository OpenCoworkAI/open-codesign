---
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
"@open-codesign/desktop": patch
---

Add a LiteLLM Gateway preset to Settings → Add provider. It pre-fills an OpenAI-compatible endpoint at `http://localhost:4000/v1`, starts in keyless mode for proxies without a master key, and explains how to switch to a master/virtual key. LiteLLM is not bundled.
