---
"@open-codesign/shared": patch
"@open-codesign/desktop": patch
---

Preserve `modelFast`, `imageGeneration`, and `designSystem` when other settings writes rebuild the on-disk v3 config, so the fast model and related optionals are not cleared after the next provider or import save.
