---
"@open-codesign/providers": patch
"@open-codesign/desktop": patch
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
---

Allow image generation to use the signed-in ChatGPT subscription OAuth path.

The image asset provider list now includes ChatGPT subscription alongside
OpenAI API and OpenRouter. When selected, `generate_image_asset` calls the
ChatGPT Codex Responses backend with the stored OAuth bearer token instead of
requiring an OpenAI API key.
