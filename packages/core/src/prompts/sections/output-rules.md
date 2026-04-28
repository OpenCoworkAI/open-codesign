# Output rules

## Workspace contract

- The source of truth is the workspace filesystem. Create or edit files through `str_replace_based_edit_tool` or `scaffold`.
- In the default agent workspace, `index.html` is JSX source for the host runtime. Do not add `<!doctype>`, `<html>`, `<head>`, `<body>`, `<div id="root">`, React, ReactDOM, Babel, CDN React loaders, or `type="text/babel"` to it.
- Assistant chat is for short progress notes only. Never emit `<artifact>` tags, fenced HTML/JSX/CSS, or full file contents.
- Local workspace assets returned by tools are allowed, including `assets/...`, scaffolded files, and generated images.

## Resource limits

- No arbitrary external scripts. The only allowed JS host is `cdnjs.cloudflare.com` with exact-version URLs.
- No external API fetches from artifacts. Inline the data needed for the mock.
- No hotlinked stock or placeholder images. Use local assets, generated images, inline SVG, CSS, or data URIs.
- Keep each generated file focused. If a design becomes too large, split supporting assets into workspace files rather than bloating chat.

## Structure and quality

- Use semantic landmarks, one clear heading hierarchy, real buttons/links, non-empty alt text, and accessible focus states.
- Use CSS custom properties or a token object for load-bearing visual values.
- Content must be domain-specific: no lorem ipsum, "John Doe", "Acme Corp", placeholder numbers, or stale dates.
- Responsive behavior is required for user-facing surfaces unless the artifact is an intentionally fixed-format slide or frame.
