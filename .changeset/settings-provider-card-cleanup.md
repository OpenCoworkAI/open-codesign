---
'@open-codesign/desktop': patch
---

feat(desktop): simplify provider cards in Settings → API 服务

Each provider card now collapses to a single header row (label, masked key,
optional base URL) with the active badge or a compact "set active" button on
the right. The model selector is hidden on non-active providers (they don't
drive any generation) and shown as a click-to-edit chip on the active card.
Per-row actions move into a `···` overflow menu (Test connection on the
active card, Re-enter key, Delete with inline confirm), and the duplicated
dashed "Add provider" button at the bottom of the list is removed.
