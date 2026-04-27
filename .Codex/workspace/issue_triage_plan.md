# Issue Triage Plan

## Goal
Review recent GitHub issue activity for open-codesign, identify still-active problems in recently closed issues, and fix the Gemini-related issue if it is reproducible from the codebase.

## Phases
- [complete] Gather issue context from GitHub, focusing on recent comments and Gemini-related threads.
- [complete] Map the issue symptoms to local code paths and reproduce or explain the bug.
- [complete] Implement the smallest aligned fix with tests if code changes are needed.
- [complete] Run targeted verification and summarize remaining risks.

## Project Constraints
- Model calls must go through `@mariozechner/pi-ai`; no direct provider SDK imports in app code.
- Use `pnpm`, Vitest, Biome, and strict TypeScript.
- Keep changes lean, local-first, and scoped.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| Vitest startup failed because `@rolldown/binding-darwin-arm64` is missing from `node_modules`. | Ran targeted provider/core tests. | Reinstall dependencies with `pnpm i`, then rerun targeted tests. |
| Initial targeted Vitest command matched no files because package-relative paths were required. | Used workspace-root paths with `pnpm --filter`. | Reran with `pnpm --dir packages/... exec vitest run src/...`; tests executed and passed. |
