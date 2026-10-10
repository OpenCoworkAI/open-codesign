---
"@open-codesign/exporters": minor
"@open-codesign/desktop": minor
"@open-codesign/i18n": patch
---

Add a beta editable PPTX export that renders HTML/JSX slides into native measured-line text boxes, basic shapes, and independent images while preserving the existing image-first default and legacy text-only library mode. Normalize preview ancestors to design coordinates, support inactive slide containers, resolve actual platform fonts without embedding them, and keep ordinary text editable alongside isolated backgrounds, nonuniform borders, and generated decorations. Multiline text is edited as separate line objects; unsupported compositing, clipping, and complex content can still require warned subtree rasterization.

Preserve CSS paint order between translucent decoration and positioned `z-index:auto` content so background grids do not cover editable text. Recognize a unique explicitly marked or proportioned poster and export its actual page aspect ratio without the preview stage, while retaining ordinary deck sizing.

Fit unstructured root/body content into one page with a warning when no slide containers or unique poster artboard are found, and reject explicit custom selectors with no matches. Add descriptive model validation, XML-character sanitation, a persistent PptxGenJS 4.0.1 XML/package repair patch, and browser plus dev-only XML-parser regression coverage. A private deck and portrait poster were opened, rendered, saved, and reopened in installed Windows PowerPoint with their objects and text retained. Document the Beta compatibility matrix, manual acceptance checklist, and synthetic fallback regressions; macOS PowerPoint and WPS remain unverified. Arbitrary CSS fidelity is not guaranteed, and small clipping/font differences can remain.
