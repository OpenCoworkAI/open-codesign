---
"@open-codesign/providers": patch
---

Fix 400 "developer is not one of ['system', 'assistant', 'user', 'tool', 'function']" when talking to OpenAI-compatible gateways (Qwen/DashScope, DeepSeek, GLM/BigModel, Moonshot, …) through a custom provider. `synthesizeWireModel` no longer hard-codes `reasoning: true`; it only flags reasoning for Anthropic, openai-responses, openai-codex-responses, or OpenAI-official endpoints on known reasoning model families (o1/o3/o4/gpt-5). (#183)
