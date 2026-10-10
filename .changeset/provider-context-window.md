---
"@open-codesign/shared": patch
"@open-codesign/core": patch
"@open-codesign/desktop": patch
"@open-codesign/i18n": patch
---

Use each model's real context window. A generation run takes the window from a new per-provider "Context window" setting in Settings → Models, then from pi-ai's model catalog, and falls back to 200k tokens only when neither knows the model. Set it for local runtimes such as Ollama or LM Studio and for relays the catalog does not know. The chat history sent with each run follows the resolved window.
