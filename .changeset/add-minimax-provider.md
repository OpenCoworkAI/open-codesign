---
"@open-codesign/shared": minor
"@open-codesign/providers": patch
"@open-codesign/desktop": patch
---

Add MiniMax as a built-in onboarding provider.

MiniMax is now available as a first-class provider option alongside Anthropic, OpenAI, OpenRouter, and Ollama. It uses the OpenAI-compatible wire (`openai-chat`) with a default base URL of `https://api.minimax.io/v1` and ships with a static model hint for `MiniMax-M2.7` and `MiniMax-M2.7-highspeed`. Credentials can be supplied via the `MINIMAX_API_KEY` environment variable or entered during onboarding.
