# Implementation plan: agent edits constrained by a confirmed selection

Status: proposed next work, not implemented by this document.
Code inspection baseline: `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
The branch now contains offline controls, a live-model disk-edit pilot and a captured-selection proposal API. These are synthetic research experiments, not production integration.
Before a production change, refresh against main and re-check these entry points.

Research progress (2026-10-27): [the disk pilot](./LIVE_RESULTS.md) completed 19 calls; [bound-edit](./BOUND_EDIT.md) subsequently removed model-supplied paths, AST IDs and hashes, with seven additional real-file controls. No fresh live-model benefit is claimed for the bound-edit API. The active-run host writer, real selection lifecycle, cancellation and alternate-tool bypass work below remain outstanding.

## First implementation slice: proposal-only agent experiment

Keep the current guard and real source-edit engine. Add a research adapter that accepts one model proposal against a host-created selection grant.
The grant binds canonical workspace identity, normalized file path, exact source hash, source-definition IDs and permitted fields.
An experimental model tool may reference a grant identifier; it must not supply its own authority.

Use a restricted toolset in [generateViaAgent](../../packages/core/src/agent.ts) to expose read/inspect and scoped proposals.
Return a patch preview and refusal reason without modifying a user's workspace.
Do not describe this as whole-agent scope enforcement if an unrestricted edit/write/command path is still available.

Acceptance:
- Existing 15 scenarios retain their outcomes.
- Forged/unknown grants, cross-workspace reuse, stale revision, cancellation and attempts to change unrelated fields fail closed.
- Supported edits preserve all bytes outside the intended patch.
- A rejected proposal produces no mutation and identifies what must be reselected or clarified.

## Second slice: a host-owned commit path

Reuse the established implementation:
- [source-edits.ts](../../packages/shared/src/source-edits.ts): validated operation and request contracts.
- [source-edit-engine.ts](../../apps/desktop/src/main/source-edit-engine.ts): exact-span planning.
- [source-edits-ipc.ts](../../apps/desktop/src/main/source-edits-ipc.ts): workspace resolution and host checks.
- [source-edit-atomic.ts](../../apps/desktop/src/main/source-edit-atomic.ts): atomic file commit.
- [useWorkspaceSourceEdit.ts](../../apps/desktop/src/renderer/src/preview/useWorkspaceSourceEdit.ts): selection lifecycle.

Important existing constraint: the manual IPC flow requires the workspace to be idle. Calling that flow during an active agent run will be refused.
Do not remove the busy check. First factor a host service whose authorization distinguishes an idle manual edit from an edit owned by the current active run; keep common workspace locks and atomic commit validation.
Bind the grant to the run, expire it on cancel/reselection/revision change, and define single-use behavior after successful commit.
Revalidate inside the file-writer lock immediately before commit. Preserve saved-but-preview-refresh-failed semantics.

Acceptance includes concurrent external writes, two requests against one grant, workspace rebinding, linked paths, cancellation before commit, and a refresh failure after a successful save.
Audit every mutation capability of the experimental run. Either disable alternate mutation tools or subject them to the same authorization; prompt instructions alone are insufficient.

## Third slice: user selection and measured usefulness

Begin with one file, one source definition and one field. Keep the existing manual editing experience unchanged while the research path is opt-in.
A reused source definition can affect multiple rendered instances; never promise instance-only editing without proving instance ownership.
Use the existing preview provenance/revision checks; model-provided coordinates or IDs are not sufficient evidence of a confirmed user selection.

On 30 frozen JSX/TSX examples, compare the same model's proposals with and without enforcement over three paired trials.
Report intended edit success, unintended changes, unsupported-case refusal, repair count, latency and usage. Include legitimate edits to measure over-rejection.
Use the repository's [background UI verification](../../apps/desktop/BACKGROUND_DEBUG.md) when UI/host interactions are implemented; byte-level correctness alone is not visual correctness.

## Dependency and promotion

Use behavior-eval run metadata and result formats once stable, but keep this branch independently runnable.
Promote the host service only after concurrency and bypass checks pass. Separate host integration from UI integration into reviewable changes.
No scene graph rewrite, batch editing or arbitrary CSS manipulation is required for the first slice.
