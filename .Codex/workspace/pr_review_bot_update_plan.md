# PR Review Bot Update Plan

## Goal

Update the Codex PR review bot so public PR reviews do not cite private/internal docs as evidence and do not rely on stale model knowledge for version-sensitive claims.

## Constraints Read

- `docs/VISION.md`
- `docs/PRINCIPLES.md`
- `docs/COLLABORATION.md`
- `CLAUDE.md`
- `AGENTS.md`

## Plan

1. Complete context scan of the bot workflow and prompt. - complete
2. Edit `.github/prompts/codex-pr-review.md` with public-evidence and fresh-version rules. - complete
3. Check the edited prompt for consistency with the workflow. - complete
4. Run lightweight validation on changed files. - complete

## Findings

- Bot is configured by `.github/workflows/codex-pr-review.yml`.
- Main behavior lives in `.github/prompts/codex-pr-review.md`.
- `docs/` is explicitly gitignored/internal; public contributors cannot see those files.
- Current prompt names internal docs as "Key docs" and asks the bot to load/cite them, which can make public reviews point at files contributors cannot access.
- Current prompt states version facts like "Electron 33+" directly, which can go stale as dependencies move.
- Updated prompt now distinguishes public context from internal-only context.
- Updated prompt requires repository/package metadata first, and public authoritative sources when needed, before version-sensitive findings.
- `git diff --check` passed.

## Errors

None so far.
