---
"@open-codesign/desktop": patch
"@open-codesign/core": patch
"@open-codesign/shared": patch
---

Coordinate participating workspace writers by canonical file path across designs.
Conditional saves and agent text edits compare expected disk bytes inside the
writer queue; stale agent edits fail visibly and refresh the file view for an
explicit retry. External processes remain outside the in-process atomicity boundary.
