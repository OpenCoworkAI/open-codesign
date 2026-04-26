---
"@open-codesign/core": minor
"open-codesign": minor
---

feat(core): add `verify_ui_kit_visual_parity` agent tool — vision-LLM judge that pairs with the deterministic `verify_ui_kit_parity`. Renders the decomposed `ui_kits/<slug>/index.html` in a hidden window, screenshots it, and asks a multimodal model to compare against the source artifact image using a research-backed structured rubric (layout / color / typography / content / components per-aspect scores, anchor-calibrated 0-1 scale, reasoning-then-score chain-of-thought per WebDevJudge / Prometheus-Vision / Trust-but-Verify ICCV 2025).

Host injects two callbacks (mirrors `generateImageAsset` pattern):
- `renderUiKit(html, signal) -> { dataUrl, mediaType }`  - headless screenshot
- `judgeVisualParity(source, candidate, signal) -> { report, costUsd }` - multimodal model call via pi-ai

Without these injections the tool returns `status="unavailable"` and the agent proceeds with the deterministic verifier alone.

`decomposePrompt.ts` (EN + ZH) updated to call BOTH verifiers and reconcile gaps before deciding whether to iterate or finish.

Closes the verification half of #225 Phase 2.
