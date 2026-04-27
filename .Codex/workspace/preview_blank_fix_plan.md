# Preview Blank Fix Plan

## Hypothesis

Root cause: workspace file preview can render a JSX-backed `index.html` through the runtime, but `FilesTabView` does not subscribe to sandbox `IFRAME_ERROR` messages, so runtime failures appear as a blank canvas and the model/user workaround becomes adding React/Babel CDN scripts directly to `index.html`.

## Tasks

- [ ] Add regression coverage for HTML + `text/babel` preview and file-tab iframe error handling.
- [ ] Wire `FilesTabView` iframe messages through the same trusted `IFRAME_ERROR` path as `PreviewPane`.
- [ ] Tighten prompt/output guidance so generated `index.html` stays host-runtime source, not standalone CDN HTML.
- [ ] Run focused tests.
