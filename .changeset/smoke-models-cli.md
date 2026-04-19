---
'open-codesign': minor
---

feat(scripts): add `pnpm smoke` batch model/prompt tester

`scripts/smoke-models.ts` runs a (provider × model × prompt) matrix through the same `generate()` code path the desktop app uses, saves each artifact to `/tmp/smoke/`, and prints a colored report with quality flags (multiple `<main>` elements, emoji icons, missing EDITMODE block, JS syntax errors via acorn).

API keys come from environment variables (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, etc.) — never stored in the repo. Models and prompts live in `scripts/smoke-models.toml`.

CLI flags: `--model`, `--prompt`, `--only-failed`, `--config`.

Sanitize TOML prompt names against path traversal — model/prompt slugs now collapse any non-`[a-zA-Z0-9._-]` character to `_`, and the resolved artifact path is verified to stay inside `/tmp/smoke/` before write.
