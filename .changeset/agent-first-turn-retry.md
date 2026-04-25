---
"@open-codesign/core": patch
"@open-codesign/providers": patch
---

Fix: retry first-turn agent generation on transient provider errors (5xx, 429, network). The agent runtime now wraps `agent.prompt()` + `waitForIdle()` in a backoff loop for the first turn only — multi-turn requests still fail fast to avoid corrupting mid-session tool state. Extracted a generic `withBackoff` helper in `@open-codesign/providers` that shares the existing classify/jitter/Retry-After/abort logic with `completeWithRetry`. (#125)
