# @open-codesign/exporters

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
