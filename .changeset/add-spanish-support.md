---
'@open-codesign/desktop': minor
'@open-codesign/i18n': patch
'@open-codesign/templates': patch
---

feat(i18n): add full Spanish (ES) language support

Added comprehensive Spanish (Neutral Latin American) localization.
- Translated 889 core i18n keys in `packages/i18n`.
- Translated dashboard templates and examples catalog in `packages/templates`.
- Registered 'es' locale in the UI (LanguageToggle and Settings).
- Updated IPC handlers in `apps/desktop` to support Spanish locale persistence.
