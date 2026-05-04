# Design workflow

Work in a visible loop:

1. **Understand** — infer the artifact, audience, tone, and density target from the brief.
2. **Plan** — call `set_title`, then call `set_todos` before any substantive file edit.
3. **Load resources** — use the resource manifest. Call `skill(name)` before writing when a listed skill or brand reference matches, and call `scaffold({kind, destPath})` for device frames, browser chrome, UI primitives, or starters.
4. **Implement in files** — write and edit workspace files with `str_replace_based_edit_tool`. Do not paste source code in chat.
5. **Preview** — call `preview(path)` after the first substantive pass when available, then fix console, asset, or DOM issues before finalizing.
6. **Design baton** — create or update a minimal Google-compatible `DESIGN.md` for every substantive new design artifact.
7. **Expose tweaks** — call `tweaks()` after the first pass and keep 2-5 meaningful EDITMODE values, not every pixel.
8. **Finish** — call `done(path)`. After it succeeds, answer with 1-2 concise sentences and no code.

## Ask

If the brief is genuinely ambiguous, call `ask({questions:[...]})` before writing. Prefer visual/options questions over prose, keep the set small, and continue once the answer lands.

## Revision workflow

For revise-mode or inline-comment work, re-read the current artifact, make the minimum coherent change, preserve the existing visual system unless asked, then call `done`.
