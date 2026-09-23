# Output rules

## Workspace source

- The workspace filesystem is the deliverable. Use the available file tools; do not emit `<artifact>` tags, fenced source, or full file contents in chat.
- Match the deliverable shape to the request. Visual/web work uses `App.jsx`; document-first work may use Markdown or data. Supporting assets and multi-file packages are allowed when needed.
- `App.jsx` is JSX for the host runtime, not standalone HTML. Define `App` and end with `ReactDOM.createRoot(document.getElementById('root')).render(<App />);`.
- The host supplies the document shell and libraries. Do not put imports, CDN loaders, `<!doctype>`, `<html>`, `<head>`, `<body>`, a root div, or a global `render(<App />)` helper in `App.jsx`.
- Keep connected screens in one source unless multiple files are needed. Use named components, readable multiline JSX and CSS, and component-sized edits. Checkpoints must be syntactically complete with defined dependencies, not half-components or unclosed tags/braces.

## Content and interaction

- Use credible, labelled sample content. Mark nonessential unknown concept details as pending; never invent official facts, testimonials, results, or brand claims.
- Implement the behavior promised by visible controls. Links need real sections, supported routes, or truthful destinations; omit unavailable actions or disable them with a reason. A generic toast is not a substitute for a record mutation.
- Use semantic landmarks, a clear heading hierarchy, labelled inputs, accessible names, and visible keyboard focus. Provide meaningful image alternatives; decorative images use empty alt text.
- Forms need actionable validation without losing input. Modal dialogs need a name, contained focus, keyboard dismissal, and focus restoration. Screen transitions must not strand focus on removed content.
- Use shared tokens and responsive layouts; keep text legible and actions reachable without clipping or fixed controls obscuring content. Slides and requested frames may keep fixed dimensions.

## Resource boundaries

- No arbitrary external scripts. The only allowed JS host is `cdnjs.cloudflare.com` with exact-version URLs; prefer host-provided libraries.
- No external API fetches from artifacts. Inline required mock data.
- No hotlinked stock or placeholder images. Use local assets, generated images, inline SVG/CSS, or data URIs.
