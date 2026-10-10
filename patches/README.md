# PptxGenJS 4.0.1 XML validity patch

`pptxgenjs@4.0.1.patch` repairs the two published entry points used by this workspace (`dist/pptxgen.cjs.js` and `dist/pptxgen.es.js`):

- Escape text-run `fontFace` attributes using the library's existing `encodeXmlEntities` helper. Ordinary text must not be pre-escaped by callers.
- Declare `/ppt/slideMasters/slideMaster1.xml` once in `[Content_Types].xml`, matching the single master actually written by PptxGenJS. Slides and layouts are not separate slide masters.

The root `pnpm.patchedDependencies` entry and lockfile patch hash make this repair reproducible on install; do not edit installed `node_modules` files. The standalone browser bundles are not used by this workspace and are not modified.

Regression coverage lives in `packages/exporters/src/pptx-model.test.ts`. It exercises both module entry points, parses every generated XML/relationship part without parser recovery, validates internal relationship targets and ContentTypes override existence/uniqueness, and checks literal text/typeface round-trips.

After an upstream upgrade, check whether these fixes are included before removing or refreshing the patch. To refresh against the pinned version:

```sh
corepack pnpm@10.33.4 patch pptxgenjs@4.0.1
# Edit only the extracted package directory reported by pnpm.
corepack pnpm@10.33.4 patch-commit <extracted-directory> --patches-dir patches
corepack pnpm@10.33.4 --filter @open-codesign/exporters exec vitest run src/pptx-model.test.ts
```

XML parsing uses the existing MIT-licensed `@xmldom/xmldom` 0.8.13 version as an explicit, test-only devDependency. It adds no shipped/runtime dependency.
