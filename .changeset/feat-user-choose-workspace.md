---
'@open-codesign/desktop': minor
---

feat(desktop): per-design workspace folder linking

Users can now bind any open design to a local folder directly from the Files panel. Every file the agent writes is mirrored to that folder in real time, and the binding persists across restarts.

- **Bind on first use** — click "Choose folder" in the Files panel to pick a workspace directory; the design is linked immediately and files are synced.
- **Rebind with migration** — choosing a different folder prompts a confirmation dialog; existing tracked files are copied to the new location before the binding switches.
- **Clear binding** — a "Disconnect folder" action removes the link without touching files on disk.
- **Error surfacing** — write-through failures and IPC errors (migration collision, missing tracked file) are now reported to the UI instead of being silently swallowed.
- **Cross-platform path comparison** — the rebind dialog no longer triggers falsely when paths differ only by trailing slash or directory-separator style.
