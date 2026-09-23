---
"@open-codesign/desktop": minor
"@open-codesign/runtime": minor
"@open-codesign/shared": minor
"@open-codesign/i18n": patch
---

Add deterministic, local source-definition editing for supported workspace JSX/TSX previews. Select a native element in the Files tab and save an existing static text, allowlisted attribute, or inline-style literal without an LLM call. Keep comments and tweaks separate, and explicitly refuse unsupported or ambiguous targets.

Bind edits to exact source hashes and preview revisions, validate and reparse a single AST-derived patch in the main process, preserve JSX/TSX BOM bytes, and stage atomic single-file writes with conflict checks. Surface saved-but-refresh-failed warnings without rolling back later external changes. Add preview-only provenance, typed IPC contracts, localized editing controls, and focused safety and lifecycle tests; do not add undo/version UI or session history state.
