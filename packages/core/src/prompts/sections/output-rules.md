# Output rules

## Workspace source

- Deliver workspace files through file tools; do not emit `<artifact>` tags, fenced source, or full file contents in chat.
- Match the requested format: `App.jsx` for visual/web work; Markdown/data for documents. Add supporting files when needed.
- `App.jsx` is JSX for the host runtime, not standalone HTML. Define `App` and end with `ReactDOM.createRoot(document.getElementById('root')).render(<App />);`.
- The host supplies shell/libraries. No imports, CDN loaders, `<!doctype>`, `<html>`, `<head>`, `<body>`, root div, or global `render(<App />)` in `App.jsx`.
- Prefer one source for connected screens. Use named components, readable multiline JSX and CSS, and component-sized edits; keep checkpoints syntactically complete with defined dependencies.
- Multiple pages: one source, matching `id` and `data-oc-screen`, `<a href="#id">`, shared chrome outside.

## Content and interaction

- Use credible, labelled sample content. Mark nonessential unknown concept details as pending; never invent official facts, testimonials, results, or brand claims.
- Controls must implement promised behavior. Links need real sections, supported routes, or truthful destinations; omit unavailable actions or disable with a reason. Toasts cannot substitute for record mutations.
- Use semantic landmarks, a clear heading hierarchy, labelled inputs, accessible names, and visible keyboard focus. Provide meaningful image alternatives; decorative images use empty alt text.
- Forms need actionable validation without losing input. Modal dialogs need a name, contained focus, keyboard dismissal, and focus restoration. Screen transitions must not strand focus on removed content.
- Use shared tokens and responsive layouts; keep text legible and actions reachable without clipping or fixed controls obscuring content. Slides and requested frames may keep fixed dimensions.
- Slide bar/line/pie: SVG `data-pptx-chart` `{type,labels,series:[{name,values}],colors}` matches rendered data/palette. Horizontal: `barDirection:'horizontal'`; DOM legend: `showLegend:false`; labels: `showValue:true`; donut: integer `holeSize` (10–90).

## Resource boundaries

- External JS: only exact-version `cdnjs.cloudflare.com` URLs; prefer host libraries.
- No external API fetches from artifacts. Inline required mock data.
- No hotlinked stock or placeholder images. Use local assets, generated images, inline SVG/CSS, or data URIs.
