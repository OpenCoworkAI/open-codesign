---
"@open-codesign/desktop": patch
"@open-codesign/core": patch
"@open-codesign/shared": patch
"@open-codesign/exporters": patch
"@open-codesign/providers": patch
"@open-codesign/artifacts": patch
"@open-codesign/runtime": patch
---

Re-enable remaining demoted lint rules in biome.json (Closes #118):

- Enable `suspicious/noAssignInExpressions` as error; refactor regex-while assignment patterns in pptx.ts
- Enable `complexity/noExcessiveCognitiveComplexity` as error; add inline `biome-ignore` suppressions for 172 pre-existing complexity violations across 82 files
- Enable `complexity/noForEach`, `a11y/useButtonType`, `a11y/useFocusableInteractive`, `a11y/useSemanticElements`, `a11y/noSvgWithoutTitle`, `a11y/useKeyWithClickEvents`, `a11y/useValidAnchor` as error (all clean)
- Fix `a11y/useFocusableInteractive` in CanvasTabBar: add tabIndex to tab elements
- Add `biome-ignore` suppressions for a11y resize handle separators (App.tsx, FilesTabView.tsx) and AskModal section/group
