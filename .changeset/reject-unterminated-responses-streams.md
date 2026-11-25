---
"@open-codesign/providers": patch
"@open-codesign/core": patch
"@open-codesign/desktop": patch
---

Reject OpenAI Responses streams that end before a valid terminal event instead of accepting partial output as a completed design. Preserve explicit incomplete/length, failed, cancelled and tool-only outcomes, including Codex event normalization. No request replay or non-streaming fallback is added.
