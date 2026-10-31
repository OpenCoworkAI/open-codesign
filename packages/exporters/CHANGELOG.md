# @open-codesign/exporters

## 0.2.0

### Minor Changes

- 634c1b7: Add a beta editable PPTX export that renders HTML/JSX slides into native measured-line text boxes, basic shapes, and independent images while preserving the existing image-first default and legacy text-only library mode. Normalize preview ancestors to design coordinates, support inactive slide containers, resolve actual platform fonts without embedding them, and keep ordinary text editable alongside isolated backgrounds, nonuniform borders, and generated decorations. Multiline text is edited as separate line objects; unsupported compositing, clipping, and complex content can still require warned subtree rasterization.

  Preserve CSS paint order between translucent decoration and positioned `z-index:auto` content so background grids do not cover editable text. Recognize a unique explicitly marked or proportioned poster and export its actual page aspect ratio without the preview stage, while retaining ordinary deck sizing.

  Fit unstructured root/body content into one page with a warning when no slide containers or unique poster artboard are found, and reject explicit custom selectors with no matches. Add descriptive model validation, XML-character sanitation, a persistent PptxGenJS 4.0.1 XML/package repair patch, and browser plus dev-only XML-parser regression coverage. A private deck and portrait poster were opened, rendered, saved, and reopened in installed Windows PowerPoint with their objects and text retained. Document the Beta compatibility matrix, manual acceptance checklist, and synthetic fallback regressions; macOS PowerPoint and WPS remain unverified. Arbitrary CSS fidelity is not guaranteed, and small clipping/font differences can remain.

- e94c3c1: Preserve rich text and list markers as editable text, regular HTML tables as
  native tables, and marked bar, line, and pie charts as native data charts in
  editable PPTX exports. Keep centered cover images and translated layers
  independently editable, map rectangular inset-clipped images to native picture
  cropping, and report local fallbacks for unsupported table
  decoration and chart restyling. Add package structure and multi-page quality
  regressions plus a reproducible PowerPoint/WPS acceptance checklist.
- 5f6036b: Add opt-in Tavily web search and bounded public-page reading through native agent tools. Persist workspace sources, evidence and stable slide usage, and generate independent Markdown companions in ordinary exports without adding citations to slides by default.

### Patch Changes

- 1d33526: Add a Node CLI for safe diagnostics, read-only workspace inspection and HTML export without
  Electron. Share desktop workspace readers and design classification through core subpaths,
  and prevent HTML asset inlining from following symlinks outside the workspace.
- e94c3c1: Export all pages of decks that mount one slide at a time behind numbered navigation, and keep ordinary table borders editable on each side of a cell. Preserve explicit chart colors, legend visibility, value labels and doughnut holes, retain horizontal category order, and respect suppressed CSS list markers.

  Ask generated slide charts to retain the matching style metadata by default.

- e94c3c1: Keep basic SVG slide charts editable as native shapes, lines, and text instead
  of rasterizing every unmarked SVG. Preserve viewBox scale, label colors, bar
  corners, and threshold lines; warn when chart data series are unavailable.
  Support horizontal native bar chart metadata and request chart data in the
  general slide and research generation guidance.
- e331e69: Add PNG to the Export menu. It renders the active design with the installed Chrome, like PDF export, and saves a full-page screenshot at 2x. Decks that show one slide at a time are expanded so every slide appears in order.
- 15e4cf3: Remove the unused vulnerable image-size dependency from PptxGenJS 4.0.1.
- Updated dependencies [c3d2ff3]
- Updated dependencies [029128d]
- Updated dependencies [0d3d63e]
- Updated dependencies [a63feb5]
- Updated dependencies [761b3b8]
- Updated dependencies [3b03e7a]
- Updated dependencies [5f6036b]
- Updated dependencies [e24d1f1]
- Updated dependencies [24815f3]
- Updated dependencies [6799d55]
- Updated dependencies [c9757a0]
- Updated dependencies [9574745]
- Updated dependencies [e331e69]
- Updated dependencies [03dea98]
- Updated dependencies [856dba8]
- Updated dependencies [ec7f76d]
- Updated dependencies [b7a0090]
- Updated dependencies [c9757a0]
- Updated dependencies [719d089]
- Updated dependencies [143cf96]
- Updated dependencies [4cf3393]
- Updated dependencies [787a8e4]
- Updated dependencies [09f21c3]
- Updated dependencies [5f6036b]
  - @open-codesign/shared@0.3.0
  - @open-codesign/runtime@0.2.0

## 0.1.7

### Patch Changes

- 0db17ee: Avoid injecting a duplicate Tailwind CDN script into exports when another external script follows an existing Tailwind script.
- 726f08e: Resolve literal local asset references before JSX/TSX is encoded into standalone
  HTML. HTML and browser-rendered exports now inline these assets, while ZIP exports
  collect and rebase them without changing the included editable source. Preserve
  CSS URL quoting and safely encode text assets in quoted attributes.
- Updated dependencies [729e356]
- Updated dependencies [f2a9dbb]
- Updated dependencies [7e8f7ff]
- Updated dependencies [a8de894]
- Updated dependencies [d199c75]
- Updated dependencies [971918b]
- Updated dependencies [a3a08e6]
- Updated dependencies [729e356]
- Updated dependencies [729e356]
- Updated dependencies [ef5677c]
- Updated dependencies [729e356]
- Updated dependencies [0c1beb0]
  - @open-codesign/shared@0.2.2
  - @open-codesign/runtime@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [7a1977d]
- Updated dependencies [6cbb639]
  - @open-codesign/shared@0.3.0
  - @open-codesign/runtime@0.1.6

## 0.1.5

### Patch Changes

- 0d4c5cf: Clean aborted transport retry history before replaying an agent turn, and keep HTML/ZIP exports offline by default by making Tailwind CDN injection opt-in for saved HTML bundles.
- 4c66392: Harden HTML, URL, marker, stack-frame, and retry parsing paths flagged by CodeQL during the v0.2 mainline promotion.
- 69d09fa: Improve exporter fidelity by resolving workspace-local assets, bundling ZIP resources, preserving Markdown tables, supporting PDF header/footer options, and rendering PPTX slides from Chrome screenshots.
- 80f9fc4: Paginate PPTX image exports with fallback slide selectors when artifacts do not define section slides.
- Updated dependencies [4cec7ea]
- Updated dependencies [4391788]
- Updated dependencies [4c66392]
- Updated dependencies [0a0ff2e]
- Updated dependencies [19b2909]
- Updated dependencies [6c3a908]
- Updated dependencies [418e5a8]
- Updated dependencies [022e1b6]
- Updated dependencies [441e7c7]
- Updated dependencies [e622d62]
- Updated dependencies [d815de5]
- Updated dependencies [a5f1cc0]
- Updated dependencies [b2a6d15]
- Updated dependencies [013fd34]
- Updated dependencies [d3a62fe]
  - @open-codesign/shared@0.2.0
  - @open-codesign/runtime@0.1.5
