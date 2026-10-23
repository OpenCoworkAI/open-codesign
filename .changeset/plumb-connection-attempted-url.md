---
"@open-codesign/desktop": patch
"@open-codesign/shared": patch
---

Plumb connection-test `attemptedUrl` into Settings diagnostics so infer-only / manual 404s are not mis-attributed as listing failures.
