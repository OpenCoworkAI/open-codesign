---
"@open-codesign/desktop": patch
---

Serve the `done` verifier and `preview` harness documents to system Chrome from memory instead of temporary files, so verification no longer fails with `ERR_FILE_NOT_FOUND` when Chrome/Chromium runs with a private `/tmp` (Snap, Flatpak).
