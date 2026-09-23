# Deterministic local source editing

Open CoDesign can edit a small, explicitly supported part of a React design directly in its workspace source. This path does **not** call an LLM or start a generation turn. It is not a general-purpose React editor or a replacement for the existing agent, comments, or tweaks.

Here, **deterministic** means that the same source and supported operation produce a reproducible source patch or refusal. It does not prove arbitrary JavaScript safe, establish that a source definition has only one rendered instance, or guarantee visual correctness in every application state.

## Use it

1. Open a design bound to a real local workspace.
2. In the **Files** tab, open an integrated preview of an actual `.jsx` or `.tsx` workspace file.
3. Choose **Edit source**. The displayed source must match the current workspace file before editing is enabled; a snapshot or fallback preview is not a writable source.
4. Select an element in the preview. The panel identifies its source file and shows supported existing fields, or explains why a target or field is unsupported. If opaque execution prevents preview selection, choose **Choose a static source field**, then select by source line, native tag and current value. Review the displayed source fragment before saving.
5. Change one field and use its **Save source definition** button.
6. Check the refreshed preview and the source file. A save can reload the preview and reset in-memory component state; state-preserving HMR is not promised. Select again when the preview or source revision changes.

The operation has **source-definition** scope. It changes a literal in the source, not a private copy of whichever DOM instance happened to be clicked. Preview selection deliberately refuses cases where its supported source boundary cannot be established. Explicit source selection instead identifies a literal in the parsed source without claiming a mapping to a live DOM element; page behavior can still affect the rendered result.

The source editor toolbar and panel reserve their own layout space outside the preview iframe, so they do not intercept clicks on artifact controls. The panel reduces the available preview width while open, which can trigger the artifact's responsive layout.

Ordinary comment and tweak behavior remains separate. Tweaks are temporarily hidden while source editing is active so the two editing paths do not compete. Leaving a tab, file, or design suppresses late UI acknowledgements for the old view; it does **not** promise to undo a save that has already been dispatched to the main process. Generation in the same design or workspace disables source editing.

## Supported fields

Both selection modes require one directly declared `App` or `_App` script entry with a direct JSX return and directly owned native JSX elements and fragments. Preview selection additionally requires the supported auto-mounted execution boundary. Explicit source selection permits effects, refs, opaque handlers and explicit mounting elsewhere in the source without asserting that a selected definition has a unique or unchanged rendered instance. It is not an arbitrary imported React application.

| Field | Supported form |
| --- | --- |
| Text | An existing static text child or supported string-literal expression. |
| Attributes | Existing static `title`, `placeholder`, or `alt` literals. |
| Inline style | Existing literal properties in a directly owned inline style object: `color`, `backgroundColor`, `fontSize`, `gap`, `padding`, `borderRadius`, `maxWidth`. |

The editor does not add absent attributes or style properties. It does not rewrite an entire file or infer which shared variable should change.

CSS values follow a narrow allowlist, not arbitrary CSS. Supported forms include literal color forms and finite nonnegative sizes with supported units; `gap`, `padding`, and `borderRadius` permit their supported short forms, and `maxWidth` also accepts `none`. CSS variables, URLs, expressions, arbitrary declarations, and unsupported value syntax are refused. An accepted source literal is not a guarantee that every browser interprets every value identically.

Directly owned `useState` state and supported pure inline state-setter handlers can coexist with static editable fields. This does not make a state-derived label or arbitrary event handler editable.

### Explicit refusals

Unsupported cases include:

- Dynamic text or attribute expressions and mapped/repeated targets. Preview selection also refuses reused entry references and ambiguous runtime ownership.
- Custom-component targets, component prop forwarding, computed or shared style objects, and unsupported spreads. Dynamic children do not necessarily prevent editing a static parent's own supported layout fields.
- Import/export module syntax and unsupported entry structure in both modes. Preview selection additionally refuses refs, effect or other non-state hooks, DOM/global mutation, timers or other scheduling, reflection, and unknown or imperative handlers outside the supported pure setter form.
- Runtime-control text in a proposed value, including certain preview/document/tweak markers, mount controls, or `App`/`_App` declaration patterns that the preview runtime currently recognizes in raw source.
- Unsupported files, unavailable workspaces, hidden or escaping paths, symlinked child paths, hard-linked source files, stale source, and saves attempted during generation.

Refusal is intentional. Switching to source selection is an explicit user action. It does not enable dynamic fields or indirect definitions, and the editor does not silently fall back to DOM mutation, broad string replacement, whole-file regeneration, or an LLM request.

## Source identity and preview metadata

Inspection binds the exact displayed source to the workspace file and returns a SHA-256 source hash and source targets. Selection and save acknowledgements are also associated with a preview revision. The source hash and preview revision serve different purposes: source bytes determine the patch baseline; the preview revision prevents a late selection or acknowledgement from being presented as belonging to a different rendered view.

Temporary preview instrumentation identifies source definitions for selection. Those markers are inserted only into the preview document, not saved into the workspace source. Ordinary exports do not add this source-edit provenance. Generated-page metadata, target IDs, and the preview revision are **not authorization**: the main process validates the request and independently reads and analyzes the current workspace source.

In explicit source selection mode the preview is not instrumented, and preview selection messages cannot change the selected source field. The request carries `selectionMode: "source"`; omission retains the strict preview mode. Both inspection and save use the selected mode, while source hashes, field validation and atomic conflict checks remain mandatory. Source-mode analysis results must never be used as preview provenance. The revision still correlates save acknowledgements with the current editor context.

For JSX/TSX, workspace reads preserve a UTF-8 BOM so preview content, offsets, hashes, and saved bytes remain aligned. Other text readers retain their existing decoding behavior; this does not change BOM handling for JSON files. Invalid UTF-8 source is rejected rather than silently transcoded.

## Save and conflict behavior

The main process:

1. Validates the versioned request, source-definition scope, operation allowlist, workspace path, and live generation state.
2. Holds the existing stable-workspace-path and canonical-file-writer leases, rereads the source, and checks the expected SHA-256 hash.
3. Parses the source locally, resolves the target independently, plans one source-span replacement, and reparses the result before saving.
4. Writes an exclusive, same-directory temporary stage, syncs it, verifies staged bytes and the current source/path, and atomically replaces the source with `rename`.
5. Returns the committed source, hash, patch, and matching preview revision, and requests a preview refresh.

Detected source conflicts are refused without overwriting the newer file. Pre-commit failures do not replace the source; cleanup of the temporary stage is attempted without overwriting the current file. There is no new session history, undo/version UI, or database-backed snapshot state for this feature.

**Concurrency boundary:** the writer lease serializes participating app writers, including different designs using the same canonical file. It is not an operating-system compare-and-swap or a lock respected by an external editor. An external process can still race the final validation and rename (TOCTOU). The implementation does not claim otherwise.

If saving has committed but the refresh notification fails, the result remains **saved**, with a warning to reload the preview. It is not reported as an unsaved edit, and the app does not blindly restore old bytes over a later external version. Inspect the workspace file when a warning or stale preview makes the visual result uncertain.

## Verification and manual checks

Relevant tests are kept alongside the implementation:

- [AST support and refusal tests](apps/desktop/src/main/source-edit-engine.test.ts)
- [Explicit source selection and execution-boundary tests](apps/desktop/src/main/source-edit-engine.source-selection.test.ts)
- [Atomic commit and failure tests](apps/desktop/src/main/source-edit-atomic.test.ts)
- [Main IPC, conflicts, and BOM round-trip tests](apps/desktop/src/main/source-edits-ipc.test.ts)
- [Workspace reader compatibility tests](apps/desktop/src/main/workspace-reader.test.ts)
- [Generation registry and workspace lifecycle tests](apps/desktop/src/main/ipc/generate.workspace-rename.test.ts)
- [Preload channel tests](apps/desktop/src/preload/source-edits.test.ts)
- [Files tab integration tests](apps/desktop/src/renderer/src/components/FilesTabView.source-edit.test.tsx)
- [Source edit persistence tests](apps/desktop/src/renderer/src/preview/source-edit-persistence.test.ts)
- [Preview lifecycle tests](apps/desktop/src/renderer/src/preview/useWorkspaceSourceEdit.test.tsx)
- [Runtime overlay tests](packages/runtime/src/overlay.test.ts)

From the repository root, using the supported Node version and installed workspace dependencies:

```sh
corepack pnpm --filter @open-codesign/desktop exec vitest run src/main/source-edit-engine.test.ts src/main/source-edit-atomic.test.ts src/main/source-edits-ipc.test.ts src/main/workspace-reader.test.ts src/main/ipc/generate.workspace-rename.test.ts src/preload/source-edits.test.ts
corepack pnpm --filter @open-codesign/desktop exec vitest run src/renderer/src/components/FilesTabView.source-edit.test.tsx src/renderer/src/preview/source-edit-persistence.test.ts src/renderer/src/preview/useWorkspaceSourceEdit.test.tsx
corepack pnpm --filter @open-codesign/runtime test
```

These are test entry points, not a claim that a full browser or packaged Electron end-to-end run has passed on a particular platform. Unit tests and Node IPC fixtures do not replace real preview verification.

In the existing desktop app, manually check a self-contained supported static sample with no model credentials or network access: compare the exact source diff, save, and verify the refreshed preview. Change the file externally between selection and save and verify a conflict leaves the external content intact. Check a BOM-prefixed JSX/TSX file, an unsupported mapped or dynamic target, switching tabs during a save, and an active generation. Confirm that no generation turn, undo/history UI, or persistent preview marker appears. A successful source edit may reset preview state; test that behavior rather than assuming HMR.

Also check a script containing effects or explicit mounting: preview selection should remain refused, while explicitly choosing an eligible source field can save a static literal. Confirm the source-mode preview has no source-selection markers, exact before/after bytes differ only at the selected field, and edits survive a full application restart. Use actual mouse input to check artifact controls near the preview's top-right edge; DOM-triggered clicks cannot detect shell overlays intercepting the same screen coordinates.

## Parser dependency review

The desktop app explicitly depends on `@babel/parser` **7.29.2**, under the **MIT** license; the package license was reviewed for this addition. A measured local installation contains 8 files totaling 1,995,536 bytes, including its source map. This is installed package size, **not** an installer-size delta. The same parser version was already present transitively in the lockfile; making it a direct desktop dependency adds three lockfile lines rather than introducing a new parser version. The main-process AST engine is imported on demand. Regex is unsuitable for reliably locating and validating JSX/TSX syntax; Acorn plus JSX would require an additional TypeScript strategy. Reusing the larger browser Babel bundle (roughly 3 MB) would couple Node-side analysis to a browser compilation bundle, and the main process should parse, not execute, generated source. A peer dependency is inappropriate for this internal desktop capability because the app must reliably ship the parser it requires.
