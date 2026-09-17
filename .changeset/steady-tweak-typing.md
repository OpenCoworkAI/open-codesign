---
"@open-codesign/desktop": patch
---

Keep inferred tweak controls and keyboard focus stable while replacing text or colors, including pauses across autosave. Validate inferred colors with the browser instead of treating arbitrary words as color names. Serialize and coalesce slow saves without losing newer drafts, weakening source conflict guards, or resetting artifact state. File/design switches and independent source replacements reset control inference; save conflicts remain visible and retain recoverable text.
