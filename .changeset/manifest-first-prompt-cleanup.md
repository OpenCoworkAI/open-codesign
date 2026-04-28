---
"@open-codesign/core": patch
"@open-codesign/providers": patch
"@open-codesign/templates": patch
"@open-codesign/desktop": patch
---

refactor: make create prompts manifest-first

- Replace keyword-routed create prompt composition with deterministic base sections plus resource manifest summaries.
- Move heavyweight guidance into lazy-loaded skills and remove stale single-shot artifact prompt exports.
- Remove full skill body injection helpers and demote old tool names in the chat working-card UI.
- Add artifact composition, chart rendering, and craft polish skill manifests for explicit progressive disclosure.
