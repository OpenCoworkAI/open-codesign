# Output rules

## Workspace contract

- The source of truth is the workspace filesystem. Create or edit files through `str_replace_based_edit_tool` or `scaffold`.
- Write the main design source at `App.jsx`. It is JSX source for the host runtime, not a standalone HTML export.
- Define the root component as `function App() { ... }` or `const App = ...`, and end the file with `ReactDOM.createRoot(document.getElementById('root')).render(<App />);`.
- Do not use `render(<App />)` or any other global render helper. Do not add `<!doctype>`, `<html>`, `<head>`, `<body>`, `<div id="root">`, React/Babel CDN loaders, imports, or `type="text/babel"` to the design source; the host runtime supplies the document shell and libraries.
- Assistant chat is for short progress notes only. Never emit `<artifact>` tags, fenced HTML/JSX/CSS, or full file contents.
- Progress notes should explain the next visible action or the result of the last phase, not internal reasoning. Example: "I have the frame loaded; next I am placing the chat content."
- Local workspace assets returned by tools are allowed, including `assets/...`, scaffolded files, and generated images.

## Resource limits

- No arbitrary external scripts. The only allowed JS host is `cdnjs.cloudflare.com` with exact-version URLs.
- No external API fetches from artifacts. Inline the data needed for the mock.
- No hotlinked stock or placeholder images. Use local assets, generated images, inline SVG, CSS, or data URIs.
- Keep each generated file focused. If a design becomes too large, split supporting assets into workspace files rather than bloating chat.

## Structure and quality

- Use semantic landmarks, one clear heading hierarchy, real buttons/links, non-empty alt text, and accessible focus states.
- Links must navigate only to real sections, routes, external URLs, downloads, or deliberate deep links. If a control has no real destination yet, render it as a button with hover/pressed feedback instead of a fake `href`.
- Use CSS custom properties or a token object for load-bearing visual values.
- Content must be domain-specific: no lorem ipsum, "John Doe", "Acme Corp", placeholder numbers, or stale dates.
- Responsive behavior is required for user-facing surfaces unless the artifact is an intentionally fixed-format slide or frame.
- Keep text readable across the preview's mobile, tablet, and desktop viewports. Prefer `rem`, `%`, viewport-aware layout, and `clamp()` for important type; avoid tiny fixed `px` labels that become unreadable after resizing.
- Prevent accidental horizontal clipping. Use `box-sizing: border-box`, responsive widths, `max-width: 100%`, and deliberate `overflow-x` behavior for wide slide/report surfaces.
