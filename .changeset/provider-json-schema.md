---
"@open-codesign/providers": patch
---

Add opt-in JSON Schema output to OpenAI chat-compatible completions through the existing pi payload hook. Reject unsupported wires before generation and preserve existing behavior when no schema is requested.
