---
"@open-codesign/desktop": minor
"@open-codesign/shared": minor
---

feat(desktop): add per-provider "Disable TLS verification" toggle for custom and imported providers. Unblocks connections to corporate gateways with self-signed or private-CA certificates that Node 22's built-in fetch cannot otherwise accept. Built-in providers (Anthropic, OpenAI, OpenRouter, Ollama) remain unaffected. (#229)
