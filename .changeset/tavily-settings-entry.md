---
"@open-codesign/desktop": minor
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
---

Add bilingual Tavily web-search settings with safe key save/replace/clear operations and explicit bounded connection testing. Apply settings to new runs without restarting while retaining per-run networking consent and active-run snapshots. Keep direct webpage reading independent of Tavily credentials, and exclude search-only credentials from the model API service list without deleting them.
