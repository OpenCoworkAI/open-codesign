---
'@open-codesign/desktop': minor
'@open-codesign/shared': minor
'@open-codesign/providers': patch
---

feat(providers): first-class Ollama support + editable custom providers

- Ollama joins the builtin provider set. `requiresApiKey: false` on the schema lets any provider — builtin or custom — opt out of API keys; `isKeylessProviderAllowed` now honors it. `extractModelIds` accepts the `{name}` shape used by Ollama's `/api/tags` endpoint as a fallback.
- New `ollama:v1:probe` IPC does a 2s liveness check against `http://localhost:11434/api/tags`, so the UI can distinguish "running", "not installed", and "unreachable" states without racing the 10s models-list timeout.
- Custom and builtin providers now have an `Edit` action. `AddCustomProviderModal` accepts an `editTarget` prop that pre-fills every field and routes save through `updateProvider` (rotates the stored secret only when the user actually types a new one — leaving it blank keeps the current mask). Builtin rows lock `baseUrl`/`wire` so users can't accidentally repoint `anthropic` at an unrelated host; only the API key and default model are editable.
- `config:v1:update-provider` gained an optional `apiKey` field with tri-state semantics (omit = keep, empty string = clear, non-empty = rotate). Runs against missing-entry builtins too, seeding from `BUILTIN_PROVIDERS` so edits work on fresh installs.
