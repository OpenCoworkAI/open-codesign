# Demo · Calm Spaces meditation app

The "Calm Spaces" mobile prototype is the headline first demo for open-codesign,
mirroring the marquee Claude Design example (see `docs/research/01-claude-design-teardown.md`).

## What it generates

A single self-contained HTML artifact rendering a phone-frame mockup of a
meditation app home screen — meditation list, play button, soft greens/blues
palette, and tunable design tokens via CSS custom properties on `:root`.

## Run it

```bash
# 1. Provide a dev API key (Anthropic key works out of the box).
export VITE_OPEN_CODESIGN_DEV_KEY=sk-ant-...

# 2. Boot the desktop app from the repo root.
pnpm install
pnpm --filter @open-codesign/desktop dev
```

Then in the app:

1. Click the **Calm Spaces meditation app** starter in the left sidebar.
2. Press **Send** (or `Enter`).
3. Within ~30 s the iframe on the right renders the design.
4. Open the **Export** menu in the preview toolbar → choose **HTML** → pick a
   destination → **Save**.
5. `open <chosen-path>` in the browser shows the same design without the app.

## Expected behaviour

- The model emits exactly one `<artifact identifier="design-1" type="html" …>`
  block. The orchestrator extracts it via `@open-codesign/artifacts` and feeds
  the HTML into the sandbox iframe.
- Tailwind is loaded via the official CDN (`https://cdn.tailwindcss.com`). The
  HTML exporter inlines the CDN tag if the model forgot to.
- All colors, spacing, and font sizes are CSS variables — that's what the slider
  tier (Phase 2) will hook into.

## Failure modes (loud, by design)

- **No key** → assistant message tells you to set `VITE_OPEN_CODESIGN_DEV_KEY`.
- **PDF / PPTX / ZIP export** → throws `CodesignError` with code
  `EXPORTER_NOT_READY` and the toast reads "PDF export ships in Phase 2".
- **Network / provider error** → propagates as a `CodesignError` with code
  `PROVIDER_ERROR`; surfaced as the assistant's reply prefixed with `Error:`.

There are deliberately no silent fallbacks anywhere in this path
(see PRINCIPLES §10).
