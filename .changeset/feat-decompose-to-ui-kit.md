---
"@open-codesign/core": minor
"open-codesign": minor
---

feat(core): add `decompose_to_ui_kit` agent tool that emits a `ui_kits/<slug>/` folder structure (index.html + components/*.tsx + tokens.css + manifest.json + README.md) shaped for downstream coding-agent handoff (Claude Code, Cursor, etc.). Decomposition is prompt-driven (no AST/parser deps); the tool persists the structured plan to the virtual fs in a single atomic call. Output carries `schemaVersion: 1` in `manifest.json` so downstream consumers can evolve safely.

Triggered explicitly via the new "Decompose to UI Kit" sidebar action — opt-in, never auto-fired. Closes the Phase 1 ask in #225.
