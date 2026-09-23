---
"@open-codesign/desktop": patch
---

Persist generation run IDs, ordered events and terminal results in local JSONL, and reattach renderer streams after reload or focus without duplicate chat writes. Persist structured questions and answers, recover answer drafts, and make answer retries idempotent across windows. Mark orphaned executions interrupted after a main-process restart instead of rerunning side effects; keep cancellation locks until the original worker settles.
