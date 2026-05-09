---
"@open-codesign/desktop": patch
---

Harden desktop provider setup by sanitizing agent-supplied SVG choice icons, storing new API keys with Electron safeStorage when available, redacting encrypted secret rows from diagnostics, and requiring explicit opt-in before testing local or private-network provider URLs.
