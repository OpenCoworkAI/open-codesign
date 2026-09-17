---
"@open-codesign/desktop": patch
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
---

Compare active-message context against the immutable comment content submitted to the running generation, not just comment IDs. Revised comments remain pending and drafts are retained.

Generation completion now uses an atomic expected-content check when marking comments applied. Only matching revisions are consumed; conflicts are reported without failing the completed generation. Late responses cannot overwrite newer visible edits, and editing an applied comment makes the new content pending. Existing explicit bulk marking remains compatible.
