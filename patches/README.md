# Dependency compatibility patches

## pi-ai 0.72.1 hosted web search

`@mariozechner__pi-ai@0.72.1.patch` adds an awaited raw-event hook to the existing OpenAI Responses and Anthropic providers, forwards it through simple options, and preserves same-provider/model native tool output during message conversion. It does not add a provider SDK or HTTP implementation. The MIT-licensed pi dependency and its pinned version remain unchanged.

The Open CoDesign pi adapter owns search authorization, request accounting, citation normalization, and bounded Claude pause continuation. Provider-specific output stays in local JSONL sessions for replay; it is never replayed to a different model or provider. Synthetic protocol tests are in the providers package. Re-evaluate this patch against upstream when updating pi; do not edit installed dependency files.

## PptxGenJS 4.0.1 XML validity

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

The root `pnpm.overrides` also removes `image-size` specifically from `pptxgenjs@4.0.1`. The published CJS and ESM entry points do not import it; their only `sizeOf` reference is inside a commented-out block. Removing this unused dependency avoids shipping the vulnerable 1.x parsers without forcing PptxGenJS onto a different major API. Recheck the override when upgrading PptxGenJS. Both entry points and image embedding are covered by the exporter tests.

XML parsing uses MIT-licensed `@xmldom/xmldom` as an explicit, test-only devDependency. It adds no shipped/runtime dependency.
