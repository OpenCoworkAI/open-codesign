---
"@open-codesign/shared": patch
"@open-codesign/core": patch
"@open-codesign/i18n": patch
---

Fit each generation run into the model's context window. Before the request, the system prompt, tool definitions and the prompt are measured in tokens, and a quarter of the window (at most the 32,000 tokens a run requests) stays free for the reply; the request asks for no more output than that, so models with a window under 128k tokens request less than 32,000. If those parts do not fit, the run stops with an error that names the window and points to the context window setting in Settings → Models, instead of sending a request the model would truncate. Chat history keeps its newest messages that fit what remains.
