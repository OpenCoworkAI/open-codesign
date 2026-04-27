# AGENTS.md v2 Update Plan

## Goal

Update `AGENTS.md` so Codex agents follow the latest v0.2 plan instead of the stale `CLAUDE.md` copy.

## Sources Read

- `CLAUDE.md`
- `AGENTS.md`
- `docs/VISION.md`
- `docs/PRINCIPLES.md`
- `docs/v0.2-plan.md`

## Steps

1. Identify stale CLAUDE/AGENTS content. - complete
2. Rewrite `AGENTS.md` around v0.2 agentic workspace decisions. - complete
3. Validate for stale references and whitespace issues. - complete

## Findings

- `CLAUDE.md` and current `AGENTS.md` still describe Open CoDesign mainly as a prompt-to-artifact app rather than a local design agent.
- They still point design history at SQLite, while v0.2 moves sessions to pi JSONL and files to real workspaces.
- They say pi-ai gaps should become `packages/providers` extensions, but the pi spike says provider/session/capability/bash should be handed to pi-coding-agent.
- They hard-code some stack versions; `AGENTS.md` should tell agents to read manifests for exact versions.
- Latest plan: design equals pi session, every design has a workspace, no sealed/open mode, no project abstraction in v0.2.
- Validation found no stale old phrases for `better-sqlite3`, old provider-extension guidance, hardcoded React/Vite versions, or old storage wording.
- `git diff --no-index --check /dev/null AGENTS.md` produced no whitespace warnings.

## Errors

- First stale-phrase search used a shell command with unescaped backticks in the pattern. That triggered command substitution. Re-ran with `rg -e` patterns and no backticks.
