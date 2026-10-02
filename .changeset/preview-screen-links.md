---
"@open-codesign/runtime": minor
"@open-codesign/core": patch
---

Switch multi-page prototypes inside one preview document. Matching `id` and `data-oc-screen` values identify each screen, `#id` links select one screen, and shared chrome stays visible. Inactive screens use the `hidden` attribute so their own layout remains intact.
