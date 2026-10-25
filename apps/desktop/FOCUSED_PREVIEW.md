# Focused preview for source edits

The internal design agent can inspect a rendered block through the existing `preview`
tool, edit the workspace with its existing source tools, and inspect that block again.
The host exposes it through the normal internal agent toolset. No extra external
operation, model or GUI mode is required.

```json
{
  "path": "App.jsx",
  "focus": { "selector": "#pricing", "scale": 2, "padding": 16 }
}
```

`focus.selector` must match exactly one visible element. The preview reveals the block
in its scroll container and captures it after any supplied interaction `steps`.
`scale` ranges from 1 to 3 (default 2); padding ranges from 0 to 64 CSS pixels (default 16).
The CSS viewport, source and layout remain unchanged: magnification applies to the
screenshot capture. The image replaces the usual viewport screenshot for that call.
Omit `focus` to check the whole viewport again.

Vision models receive the image as normal image tool-result content. The `focus` report
also contains the selector, source entry path, document bounds, screenshot clip/scale,
up to 2,000 characters of rendered text and up to 4,000 characters of markup. Text-only
models receive this metadata without an image. Missing, ambiguous or hidden targets
produce an explicit failed preview rather than silently showing a different region.
Images are capped at 4,096 pixels per side and 8 megapixels; select a smaller block or
reduce scale if necessary. Every preview starts a fresh document, so repeat required
setup steps when inspecting an interactive state.

For example, ask: “Inspect the pricing card at 2x, fix its crowded text without changing
the other cards, then check the card and the whole page again.” The agent can select the
card, read its source, make a targeted edit, and repeat the focused preview before `done`.
Rendered markup is untrusted page data and helps locate a change; it is not a source map.
Read the current source and follow component imports before editing. The source path
identifies the preview entry, including an HTML artifact's resolved source reference;
it does not claim that an imported component is defined in that entry file.

Node tests cover tool inputs/image delivery, selection failures, screenshot budgets and
runtime wiring through a substituted browser boundary. The real-browser regression in
`src/main/preview-runtime.test.ts` checks PNG dimensions, source editing and
repeated block inspection on a host with system Chrome through the existing desktop Vitest suite.
Run it with `pnpm --filter @open-codesign/desktop test src/main/preview-runtime.test.ts -t 'magnifies a selected block'`. Set
`CODESIGN_FOCUSED_PREVIEW_TEST_OUTPUT` to an evidence directory to retain both PNGs,
source versions and preview reports; otherwise the test removes its temporary files.
Use the existing background verification guidance when running browser tests on an interactive desktop.

This supplies visual observation for the scoped-edit experiment. A model-selected CSS
selector does not create a trusted selection grant or enforce mutation scope. Preserve
the research branch's host-owned authorization, revision checks and commit boundaries.
