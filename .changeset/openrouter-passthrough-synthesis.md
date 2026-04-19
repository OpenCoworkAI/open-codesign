---
'@open-codesign/providers': patch
---

fix(providers): synthesize Model for OpenRouter ids missing from pi-ai registry

OpenRouter is a pass-through gateway whose catalog grows faster than pi-ai's hardcoded `models.generated.js`. Previously, any id absent from the registry (e.g. `xiaomi/mimo-v2-flash:free`, `mistralai/devstral-2:free`) hit a hard `Unknown model` throw and was unusable.

Now, when `pi.getModel('openrouter', id)` returns undefined we synthesize a Model with the verified pass-through shape (`api: 'openai-completions'`, `baseUrl: 'https://openrouter.ai/api/v1'`, `reasoning: true`, default 131072 context window) and proceed. Non-openrouter providers still throw `PROVIDER_MODEL_UNKNOWN` because they are not pass-through.

The reasoning self-healing layer in `@open-codesign/core` already handles 400 "not supported" responses, so `reasoning: true` on the synthesized model is safe.
