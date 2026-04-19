---
'@open-codesign/artifacts': patch
---

fix(artifacts): close remaining streaming parser leak paths

The open-tag scanner is now quote-aware: a `>` inside a quoted attribute value (e.g. `title="a > b"`) no longer truncates the tag, drops the title, or leaks raw `<artifact ...` markup into a text event when the stream split lands mid-attribute.
