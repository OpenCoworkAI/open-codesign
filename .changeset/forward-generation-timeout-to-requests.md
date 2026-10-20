---
"@open-codesign/desktop": patch
"@open-codesign/core": patch
"@open-codesign/providers": patch
---

Apply Settings → Advanced → Generation timeout to each model HTTP request as well as the overall run, so long turns against local LM Studio / Ollama / vLLM endpoints are no longer cut off by the provider SDK's 10-minute default.
