---
"@open-codesign/core": minor
"@open-codesign/desktop": minor
"@open-codesign/i18n": patch
---

Add **Decompose to UI Kit** — opt-in sidebar action that emits a `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}` bundle shaped for downstream coding-agent handoff (Claude Code, Cursor). Decomposition is prompt-driven (no AST/parser deps); the orchestrator persists the structured plan to the virtual fs in a single atomic call. Output carries `schemaVersion: 1` so downstream consumers can evolve safely.

Three new agent tools in `packages/core/src/tools/`:

- `decompose_to_ui_kit` — orchestrator. Emits the full bundle from a source image + design brief.
- `verify_ui_kit_parity` — deterministic verifier (no LLM, no cost): element-count parity, visible-text coverage, token coverage. Returns `passCount/totalChecks` derived score (no fabricated floats).
- `verify_ui_kit_visual_parity` — vision-LLM judge wrapper. 12-check boolean rubric across 5 dimensions (layout / color / typography / content / components), anchor-calibrated reasoning-then-score chain-of-thought (WebDevJudge / Prometheus-Vision / Trust-but-Verify ICCV 2025). Host injects `renderUiKit` (headless screenshot) and `judgeVisualParity` (multimodal call) via the same deps interface as `generate_image_asset`. Without injections the tool returns `status: "unavailable"` and the agent proceeds with the deterministic verifier alone.

`decomposePrompt.ts` (EN + ZH) walks the agent through decompose → verify (both) → reconcile gaps → iterate (max 2) → done with HONEST cost summary. Per-decompose cost surfaces inline as a toast.

Refs #225 (Phase 1 of the requested image → componentization → prototype workflow). Phase 2 (cross-page flows, state machines, prototype orchestration) is tracked separately.
