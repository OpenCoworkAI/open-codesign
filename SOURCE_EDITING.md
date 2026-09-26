# Deterministic local source editing

Open CoDesign can edit a small, explicitly supported part of a React design directly in its workspace source. This path does **not** call an LLM or start a generation turn. It is not a general-purpose React editor or a replacement for the existing agent, comments, or tweaks.

Here, **deterministic** means that the same source and supported operation produce a reproducible source patch or refusal. It does not prove arbitrary JavaScript safe, establish that a source definition has only one rendered instance, or guarantee visual correctness in every application state.

## One editing flow

1. Open a design bound to a real local workspace.
2. In **Files**, open an integrated preview of an actual `.jsx` or `.tsx` workspace file.
3. Choose **Edit source**. The displayed source must match the current workspace file; a snapshot or fallback preview is not writable source.
4. Select an element in the preview. The panel shows supported fields, their source origins and any field-specific refusal. If you hit a nested icon, explicitly select a containing element from the breadcrumb buttons.
5. Change one field and use its **Save source definition** button. Text segments are labeled **Text 1**, **Text 2**, etc., rather than source offsets.
6. Check the refreshed preview and source. A save can reload the preview and reset component state; state-preserving HMR is not promised. Select again after the preview or source revision changes.

There is no separate source-selection mode or whole-file static-field picker. Source locations remain read-only explanations in the same panel. Content in an unrendered branch must first be made visible; a source definition alone does not create a clickable runtime element.

The operation has **source-definition** scope. It changes the actual literal, not a private copy of the clicked DOM instance. A component/map literal or shared variable can therefore change every use of that definition. No single-instance override is offered.

The toolbar and panel reserve layout space outside the iframe; the panel can change the available responsive viewport width. While editing is active, a temporary hit layer intercepts artifact actions and allows selection of disabled controls. It does not wrap source text or insert children into the artifact's React layout. Leaving editing removes the hit layer and restores ordinary preview interaction.

Comments remain separate. Tweaks are hidden while source editing is active so the paths do not compete. Leaving a tab, file or design suppresses late UI acknowledgements for the old view; it does **not** undo a save already dispatched to main. Generation in the same design or workspace disables editing.

## Supported fields

Inspection requires one directly declared `App` or `_App` script entry with a direct JSX return. Text targets are **native JSX source definitions**, including definitions inside local components and callback/conditional JSX. This is not arbitrary imported React application support.

| Field | Supported form |
| --- | --- |
| Text segments | Existing JSX text or string expressions, including segments beside icons, `<br />`, emphasis and unresolved dynamic siblings. Each save changes one segment and preserves child elements. |
| Traced text | Lexically resolved `const` strings/aliases and static object/array paths such as `resume.name` or `cards[1].title`, ending at a same-file string literal. The actual literal, line and origin chain are shown. |
| Shared text | Literal JSX inside a local component or map callback. Saving edits the definition and all its uses, not one rendered instance. |
| Attributes | Existing static `title`, `placeholder` or `alt` literals with directly owned native App targets. |
| Inline style | Existing literal `color`, `backgroundColor`, `fontSize`, `gap`, `padding`, `borderRadius` or `maxWidth` in a directly owned inline style object. |

Effects, refs, opaque handlers and explicit mounting elsewhere do not blanket-disable candidates. Attribute/style ownership and literal allowlists still apply. Each candidate must independently match the current preview before the UI offers saving.

For example, `<button>Cart ({count})</button>` exposes the static prefix and suffix through preview selection; it does not make `count` editable. There is no need to switch modes.

### Field-level preview mapping

Inspection provides ordered direct-child descriptors: static text segments, marked native child boundaries and unknown dynamic positions. The overlay aligns these with the selected element's actual direct text nodes and children. It does not flatten nested element text, evaluate generated expressions, inspect React private internals, or search the page for the first equal string.

- A field is enabled only when its rendered position is uniquely established. Matching preserves complete React scalar Text-node slots; it never accepts a substring of a surviving sibling as a removed field. A dynamic sibling alone is not grounds for rejecting static text.
- An ambiguous or changed field is disabled with a reason. Independent fields, including matching attributes/styles, can remain available.
- Attribute values and normalized **inline** style values are checked independently; computed/inherited styles are not source locations.
- Matching is bounded (256 layout descriptors, 128 fields for text mapping, 1,024 child nodes, 50,000 text units and 30,000 search steps per host). Large or ambiguous structures can be refused conservatively.
- A preview-only observer starts before generated code executes. It remembers field Text-node identities and records removals/character changes; replacing a static node with an equal-valued node does not silently restore readiness. Before initial binding, removing matching text is conservatively refused. Pending records are flushed synchronously before selection and save validation. Observation is bounded (4,096 records / 10,000 visited nodes per batch); overflow disables text mapping until reload.
- Selection readiness is refreshed while editing, and the parent requests a fresh check of the pinned DOM instance immediately before dispatching a save. Replies are tied to the current iframe, request and preview revision. Imperative changes or React replacing scalar nodes can require reloading rather than automatically rebinding an uncertain origin.

These checks improve source/display correspondence; they are not proof against arbitrary same-frame script tampering, ambient prototype changes or future imperative overwrites. The main process never treats preview metadata as write authorization.

### Source resolution and limitations

The resolver parses source; it never executes it. It checks lexical shadowing, writes, aliases, container escapes, duplicate keys, getters and spreads. A bounded read-only inline array `map` may coexist with traced fields, but does **not** make its callback parameter an editable data instance. The complete object/array must be static. Unsupported uses such as `flatMap`, `filter`, destructured callbacks or passing containers to unknown code conservatively disable indirect edits through that connected container.

The editor does not add absent properties, hard-code generated expressions, replace equal strings throughout a file or rewrite the whole file. A fixed array path edits that exact field and any uses of it; an unrelated equal-valued field remains unchanged.

CSS follows a narrow allowlist: supported literal colors and finite nonnegative sizes/units; `gap`, `padding` and `borderRadius` permit supported short forms, and `maxWidth` accepts `none`. CSS variables, URLs, expressions and arbitrary declarations are refused. Browser acceptance of every proposed value is not guaranteed merely by source parsing.

Unsupported cases include:

- Computed text (calls, interpolation, concatenation and conditional expressions), state-derived labels, mutable/escaping data, dynamic keys, destructuring bindings, TS expression wrappers and optional access. In particular, `items.map(item => <p>{item.title}</p>)` and component parameter text remain unsupported.
- Custom-component targets, forwarded JSX children/props, shared/computed style objects and ambiguous spreads. Literal text inside a component's native JSX is a shared definition, not a prop override.
- Import/export module syntax and unsupported entry structures.
- Unrendered source branches, ambiguous DOM correspondence, removed text and fields whose displayed values no longer match their source definitions.
- Runtime-control text in proposed values, including preview/document/tweak markers, mount controls and entry declaration patterns recognized by the runtime.
- Unsupported files, unavailable workspaces, hidden/escaping paths, symlinked child paths, hard-linked source files, stale source and saves during generation.

A refusal stays in the same preview editing interface. There is no fallback to a source picker, DOM-only mutation, whole-file regeneration or an LLM request.

## Source identity and preview metadata

Inspection binds exact displayed bytes to the workspace file and returns a SHA-256 hash and source targets. The source hash determines the patch baseline; a separate preview revision prevents old selections and acknowledgements being reused for a different rendered view.

Instrumentation adds temporary source markers only to the preview document. They are not saved in workspace source or added as editing metadata to ordinary exports. Both source-bound and ancestor-only edit selections carry the preview revision. Clicking a breadcrumb requests an actual ancestor selection in the current preview rather than selecting an arbitrary source ID locally.

HTML placeholders can resolve to nested JSX/TSX files. Loaded bytes are bound to the **requested file, design and workspace**; writes use the resolved source path. Changes outside expanded file-tree directories also invalidate preview inspection.

Mixed/indirect operations carry `textId`, identifying a parsed child segment rather than a caller-supplied write range. Actual literal-definition ranges remain separate. Main re-resolves the target at save time.

The IPC contract remains schema version 1 with additive field-layout metadata. Omitted `selectionMode` and legacy `preview` use the same unified inspector. Legacy `source` requests receive `source-mode-removed` instead of activating a permissive alternate path. Older clients omitting a segment ID cannot accidentally save a mixed field.

JSX/TSX reads preserve a UTF-8 BOM so bytes, hashes and offsets remain aligned. Invalid UTF-8 is rejected rather than silently transcoded; unrelated reader formats are unchanged.

## Save and conflict behavior

Before invoking main, the renderer verifies the selected field against the live preview. Main independently:

1. Validates the versioned request, scope, operation allowlist, workspace path and generation state.
2. Holds stable-workspace-path and canonical-file-writer leases, rereads source and checks its SHA-256 hash.
3. Parses source, resolves the target, plans one span replacement and reparses the result.
4. Writes an exclusive same-directory temporary stage, syncs it, verifies bytes/path/source and atomically replaces the file with `rename`.
5. Returns committed content, hash, patch and matching preview revision, and requests refresh.

Conflicts are refused without overwriting newer files. Pre-commit failures do not replace source. There is no new history/undo UI or database snapshot state.

**Concurrency boundary:** app writer leases serialize participating writers to the same canonical file, not external editors. They are not an OS compare-and-swap; an external process can still race final validation and rename (TOCTOU).

If commit succeeds but refresh notification fails, the result remains **saved** with a reload warning. The app does not restore old bytes over later changes. Inspect the workspace file if a stale preview makes the result uncertain.

## Verification

Relevant tests:

- [AST supported fields and refusals](apps/desktop/src/main/source-edit-engine.test.ts)
- [Unified inspection and retired-mode migration](apps/desktop/src/main/source-edit-engine.source-selection.test.ts)
- [Generated data and mixed/shared text](apps/desktop/src/main/source-edit-engine.text-coverage.test.ts)
- [Lexical provenance, mutations and escapes](apps/desktop/src/main/source-edit-provenance.test.ts)
- [Atomic writes](apps/desktop/src/main/source-edit-atomic.test.ts) and [main IPC](apps/desktop/src/main/source-edits-ipc.test.ts)
- [Files tab integration](apps/desktop/src/renderer/src/components/FilesTabView.source-edit.test.tsx) and [editing lifecycle](apps/desktop/src/renderer/src/preview/useWorkspaceSourceEdit.test.tsx)
- [Bounded field mapping](packages/runtime/src/source-edit-binding.test.ts) and [overlay selection/validation](packages/runtime/src/overlay.test.ts)
- [Browser selection, filesystem writes, refresh and reopen](apps/desktop/src/renderer/src/components/SourceEditPanel.browser.test.ts)

Run scoped desktop suites with `corepack pnpm --filter @open-codesign/desktop exec vitest run <test-paths>` and the runtime package with `corepack pnpm --filter @open-codesign/runtime test`.

Run the browser suite from the desktop directory with `corepack pnpm exec vitest run src/renderer/src/components/SourceEditPanel.browser.test.ts`. It uses installed system Chromium, production handlers and the atomic writer through an HTTP bridge in a temporary workspace, with external requests blocked. This verifies browser-to-filesystem persistence, **not packaged Electron/preload E2E**. No browser is bundled/downloaded and no model credentials are required. Separate tests cover path, hash, generation, BOM, version and atomic-write protections.

Reproduction used six actual local generated designs (resume, product-page and slide structures). Their originals remain read-only and uncommitted; portable tests contain representative structures, not private copies. AST candidate counts are not a claim that every runtime state or visible field has been clicked.

In the desktop app, check a mixed static/dynamic label, an icon/text button, disabled controls, shared component definitions, fixed object/array fields and refused map parameters. Verify exact source differences and persistence after reopening. Change source externally between selection and save; change a displayed field after selection; switch files/designs during a save. Confirm source conflicts and stale/ambiguous preview mappings do not enable incorrect writes. Use actual pointer input, not only DOM-triggered clicks, and verify leaving editing restores normal controls.

## Parser dependency review

The desktop app explicitly depends on `@babel/parser` **7.29.2**, under **MIT**. A measured local installation contains 8 files totaling 1,995,536 bytes including its source map; this is installed package size, not installer delta. The version was already transitive; making it direct added three lockfile lines rather than another parser version. Main loads the AST engine on demand. Regex cannot reliably locate JSX/TSX spans; Acorn plus JSX would need an additional TypeScript strategy. Reusing browser Babel would couple Node analysis to a browser compilation bundle. A peer dependency is inappropriate for a shipped internal desktop capability. Preview-only unification adds no runtime dependency.
