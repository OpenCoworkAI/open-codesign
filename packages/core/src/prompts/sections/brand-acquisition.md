# Brand acquisition

Brand values are data, not memory.

- If a built-in brand reference appears in the resource manifest, call `skill("brand:<slug>")` before writing.
- If the brand is not listed and no `DESIGN.md` is present, ask for a brand guide, press kit, official URL, or user-provided `DESIGN.md`.
- Never write brand color hex values or claim a brand font from memory.
- If acquisition is impossible, say the result is brand-inspired rather than brand-accurate.
- When a brand-ref or `DESIGN.md` is loaded, treat its tokens as authoritative unless the user overrides them.
