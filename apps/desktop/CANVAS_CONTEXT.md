# Canvas Context

The desktop app now includes a pinned `Canvas` tab beside `Files`. It embeds a
full Excalidraw surface that can be used before the first generation, so users
can sketch wireframes, widgets, animation notes, and layout ideas before asking
the model to build or edit the UI.

## How It Works

- The renderer mounts Excalidraw in `CanvasSketchView.tsx`.
- Canvas state is stored per design through `canvas:v1:*` IPC handlers in
  `src/main/canvas-ipc.ts`.
- Scene JSON is persisted under the app user-data directory, alongside a small
  list of imported local files.
- Imported images are also surfaced as regular chat attachments so the model
  receives both the scene context and the original image files.

## Prompt Context Export

Before generation, the store converts the current scene into prompt attachments:

- `canvas-summary.md` with a compact summary of visible elements and labels
- one `canvas.svg` export for the whole scene, or
- up to four frame-specific SVG exports when Excalidraw frames are present

These artifacts are written to a temp directory and attached automatically when
the canvas contains visible content.

## Current Limitation

The current generation pipeline is still text-first. In practice that means the
model receives SVG and markdown artifacts derived from the Excalidraw scene,
plus any imported source images, rather than true bitmap-vision analysis of the
canvas itself.

## Testing Note

Vitest uses a local Excalidraw shim so renderer tests stay deterministic and do
not depend on the full browser/runtime behavior of the published Excalidraw
bundle.
