---
'@open-codesign/desktop': patch
'@open-codesign/i18n': patch
---

feat(settings): auto-discover models in custom provider modal

When adding a custom provider (e.g. a CPA at http://127.0.0.1:8317), the modal now probes the endpoint automatically after the user types a valid http(s) baseUrl, debouncing 500ms. A spinner appears inline next to the "Default model" label while discovery runs, then either a green "Found N models" badge or a muted "Could not connect" hint.

On success the "Default model" input becomes a `<select>` pre-populated with discovered model IDs, with smart auto-selection prioritising claude-sonnet-4-5 → claude-opus → claude-sonnet → gemini-2.5-pro → gpt-5 → first in list. A "Enter manually" escape hatch lets users type any ID instead, and a "Pick from list" link restores the dropdown. The probe re-fires when the API key or wire protocol changes. Empty or non-http(s) baseUrls are skipped so the existing manual flow is completely unaffected.
