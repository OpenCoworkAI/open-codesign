# Tweak Editing Root Fix Plan

## Goal

Make the tweaks panel actually edit workspace artifacts by tracing and fixing the full path from UI control changes to EDITMODE file updates and preview refresh.

## Steps

1. Trace current tweak schema/tool parsing in `packages/core`.
2. Trace renderer tweak panel, preview bridge, IPC/file APIs, and pending tweak delta handling in `apps/desktop`.
3. Add a focused failing test that proves user edits update the right EDITMODE block.
4. Patch the underlying contract rather than only the panel surface.
5. Run targeted unit tests and a relevant package typecheck if feasible.

## Findings

- `docs/` is gitignored and absent from this worktree, so product context was read from the original checkout at `/Users/haoqing/Documents/Github/codesign/docs`.
