---
"@open-codesign/core": minor
"@open-codesign/desktop": minor
"@open-codesign/i18n": patch
---

Add **Decompose to UI Kit** — one-click in the chat sidebar emits a `ui_kits/<slug>/` folder shaped for coding-agent handoff (`index.html` + `components/*.tsx` + `tokens.css` + `manifest.json` + `README.md`). Built-in deterministic + vision verifiers self-check parity using a 12-question boolean rubric (`parityScore = passCount / totalChecks`, no LLM-fabricated floats) and re-iterate on gaps. Per-decompose cost surfaces inline as a toast.

Refs #225 (Phase 1 of the requested image → componentization → prototype workflow). Phase 2 (cross-page flows, state machines, prototype orchestration) is tracked separately.
