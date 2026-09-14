---
"@open-codesign/desktop": minor
"@open-codesign/shared": minor
"@open-codesign/providers": patch
"@open-codesign/i18n": patch
---

Upgrade connection diagnostics from pass/fail connectivity to layered capability classification (authentication, endpoint shape, wire support, model discovery, role compatibility, reasoning compatibility). Missing `/models` with working inference is now `degraded-compatible`, and responses vs chat/completions mismatches are reported as structured reasons the renderer can show.

Fixes #213
