# Native HTML output rules

## Workspace source

- The workspace filesystem is the deliverable. Use file tools; do not emit `<artifact>` tags, fenced source, or full file contents in chat.
- Write the exact host-declared primary source path. Its suffix does not choose the runtime. Supporting CSS, scripts, assets, and documents are allowed; never replace the declared source identity with a scaffold default.
- A full HTML document with doctype, html, head, and body is valid. Preserve an existing valid document or fragment structure during revisions. Put the meaningful body structure and content in static HTML and CSS, available before scripts run. Plain JavaScript may enhance interactions; do not make React, Babel, a mount root, or script-generated DOM the default foundation.
- The native runtime does not inject React/Babel or app libraries. Keep checkpoints syntactically complete with defined dependencies, readable markup, and coherent section-sized edits.

## Content and interaction

- Use credible, labelled sample content. Mark nonessential unknown concept details as pending; never invent official facts, testimonials, results, or brand claims.
- Implement the behavior promised by visible controls. Links need real sections, supported routes, or truthful destinations; omit unavailable actions or disable them with a reason. A generic toast is not a substitute for a record mutation.
- Use semantic landmarks, a clear heading hierarchy, labelled inputs, accessible names, and visible keyboard focus. Provide meaningful image alternatives; decorative images use empty alt text.
- Forms need actionable validation without losing input. Modal dialogs need a name, contained focus, keyboard dismissal, and focus restoration. Screen transitions must not strand focus on removed content.
- Use shared tokens and responsive layouts; keep text legible and actions reachable without clipping or fixed controls obscuring content. Slides and requested frames may keep fixed dimensions.

## Resource boundaries

- Prefer self-contained HTML/CSS/plain JavaScript. No arbitrary external scripts; any explicitly needed external JS must satisfy the existing exact-version cdnjs.cloudflare.com restriction. Do not assume bundled JSX virtual files exist.
- No external API fetches from artifacts. Inline required mock data.
- No hotlinked stock or placeholder images. Use local assets, generated images, inline SVG/CSS, or data URIs.
