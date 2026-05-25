# @open-codesign/templates

## 0.1.6

### Patch Changes

- Updated dependencies [7a1977d]
- Updated dependencies [8ea4bff]
- Updated dependencies [6cbb639]
- Updated dependencies [bf86fea]
- Updated dependencies [7a1977d]
  - @open-codesign/shared@0.3.0
  - @open-codesign/i18n@0.2.1

## 0.1.5

### Patch Changes

- 76a0043: feat(i18n): add full Spanish (ES) language support

  Added comprehensive Spanish (Neutral Latin American) localization.

  - Translated 889 core i18n keys in `packages/i18n`.
  - Translated dashboard templates and examples catalog in `packages/templates`.
  - Registered 'es' locale in the UI (LanguageToggle and Settings).
  - Updated IPC handlers in `apps/desktop` to support Spanish locale persistence.

- 1a59eeb: feat(templates): expand the hand-curated examples gallery

  Expanded the built-in examples library to 84 hand-written prompts, added zh-CN prompt overrides, covered more scaffolds/skills/brand references, and improved the English and Chinese quick-start prompts.

- 4c66392: refactor: make create prompts manifest-first

  - Replace keyword-routed create prompt composition with deterministic base sections plus resource manifest summaries.
  - Move heavyweight guidance into lazy-loaded skills and remove stale single-shot artifact prompt exports.
  - Remove full skill body injection helpers and demote old tool names in the chat working-card UI.
  - Add artifact composition, chart rendering, and craft polish skill manifests for explicit progressive disclosure.

- Updated dependencies [76a0043]
- Updated dependencies [4cec7ea]
- Updated dependencies [4391788]
- Updated dependencies [4c66392]
- Updated dependencies [3d7b74e]
- Updated dependencies [0a0ff2e]
- Updated dependencies [0a0ff2e]
- Updated dependencies [576e341]
- Updated dependencies [19b2909]
- Updated dependencies [6c3a908]
- Updated dependencies [1a59eeb]
- Updated dependencies [a799cab]
- Updated dependencies [b793a8f]
- Updated dependencies [418e5a8]
- Updated dependencies [022e1b6]
- Updated dependencies [441e7c7]
- Updated dependencies [e622d62]
- Updated dependencies [d815de5]
- Updated dependencies [a5f1cc0]
- Updated dependencies [b2a6d15]
- Updated dependencies [863db3c]
- Updated dependencies [013fd34]
- Updated dependencies [5d22e60]
- Updated dependencies [d3a62fe]
  - @open-codesign/i18n@0.2.0
  - @open-codesign/shared@0.2.0
