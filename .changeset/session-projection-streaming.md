---
"@open-codesign/desktop": patch
---

Avoid reloading and rewriting complete chat session histories for every run event. Reuse bounded pi session caches with incremental projection indexes, refresh externally changed files, preserve interrupted records, and yield between recovery batches so large histories do not block launch and live updates.
