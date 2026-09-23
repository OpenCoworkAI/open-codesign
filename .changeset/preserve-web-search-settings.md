---
"@open-codesign/desktop": patch
---

Preserve web search opt-in and limits across provider/model changes, config imports, image settings and design-system saves. Retain Tavily credentials when deleting the last model provider. Route web research consent through the registered ask IPC and existing structured-question UI instead of the unwired legacy permission bridge, with per-run allow/deny and cancellation.
