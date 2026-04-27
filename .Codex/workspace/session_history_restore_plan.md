# Session History Restore Plan

## Root Cause

`window.codesign.chat.*` in `apps/desktop/src/preload/index.ts` is a v0.2 TODO stub. It returns empty lists and resolves appends in memory, so renderer chat rows are never persisted or reloaded.

## Plan

1. [x] Restore persisted chat IPC channels in main using the existing chat message helpers.
2. [x] Point preload chat methods at those IPC channels.
3. [x] Add IPC regression coverage for append/list, snapshot seeding, and tool status updates.
4. [x] Run the focused desktop main-process tests.
