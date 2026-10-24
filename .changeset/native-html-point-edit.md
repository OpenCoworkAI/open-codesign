---
"@open-codesign/desktop": patch
"@open-codesign/runtime": patch
"@open-codesign/i18n": patch
---

Add point-and-edit support for workspace HTML text leaves, title/placeholder/alt attributes, and allowlisted inline styles. Use parsed source locations and exact single-span patches through the existing stale-source checks and atomic writer. Temporarily pause authored scripts in HTML editing previews so selected elements map to original source; restore page interactions when editing ends. Preserve the declared native HTML runtime identity after saves.
