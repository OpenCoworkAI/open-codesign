---
"@open-codesign/desktop": patch
"@open-codesign/runtime": patch
---

Replace regex-based webpage stripping with lazy HTML5 text extraction using parse5, preserving untrusted-text semantics without executing scripts or loading page resources. Replace the preview EDITMODE wildcard expression with a forward-only scan to avoid polynomial work on repeated unmatched markers. Add malformed HTML, deep nesting, and adversarial marker regression coverage.
