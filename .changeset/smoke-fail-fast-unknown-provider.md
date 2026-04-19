---
"open-codesign": patch
---

Make the `scripts/smoke-models.ts` harness fail fast when the smoke config
references a provider not registered in `ENV_KEY`. Previously the script
silently skipped the model (treating it as "no API key set"), masking config
typos and producing false-green smoke runs.
