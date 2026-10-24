# Scoped design edits: selection authorization experiment

Branch: `research/scoped-design-edits`. Research-only; not exposed to the application or its agent.

## Hypothesis

The existing source-edit engine can supply deterministic literal patches, while a small host-owned selection grant can additionally enforce the selected file, source revision, target definitions and permitted fields.

The latest mainline already implements source hashes, AST-derived target IDs, allowlisted operations, safe literal encoding and reparsing. Reuse it instead of introducing a separate scene format or copying another project.

## What runs

`scoped-edit.ts` wraps the real `apps/desktop/src/main/source-edit-engine.ts`.
A request is checked against a host-owned grant before reaching `planSourceEdit`.
The experiment plans in-memory patches only; it does not write design files.

The grant must come from a trusted, confirmed UI selection. Its path must be the host's canonical workspace-relative path. Model arguments cannot create or broaden a grant. Workspace containment, preview revision checks, IPC validation and atomic writes remain the responsibilities of the existing host; this wrapper alone is not a security boundary.

## First observations

15 original synthetic scenarios; 16 Vitest checks passed, including report generation.
All four permitted edits applied, and all eleven refused requests were rejected by the wrapper.
The underlying engine matched the extra intent constraints in 10/15 scenarios; the wrapper matched 15/15.
This is a selected contract matrix, not a model accuracy estimate or a production vulnerability claim.

Five differences are deliberately outside the engine's standalone contract:
- An identical source file at a different path.
- A valid, same-label target outside the selected region.
- A valid color edit when only text was authorized.
- A fresh request paired with an old selection grant.
- An empty selection grant.

Existing engine refusals cover stale bytes, unknown targets, unsafe CSS, runtime markers, dynamic text and retired selection mode. Positive cases check text/style changes, BOM/CRLF and literal markup escaping.
Every accepted result preserves the exact source prefix/suffix outside the patch and leaves the footer untouched; the result is re-inspected to verify the requested value.

The typed wrapper and its integration tests also passed a focused strict TypeScript 6.0.3 check.

## Reproduce

From the repository root after the normal `pnpm install --frozen-lockfile`:

```bash
node apps/desktop/node_modules/vitest/vitest.mjs run --config research/scoped-design-edits/vitest.config.mjs
```

No new packages were added, and application code does not import this experiment. Tests run in Node and do not launch Electron, a browser, or a model.
To reuse an existing checkout's installed dependencies without changing either lockfile:

```bash
RESEARCH_DEPENDENCY_ROOT="/absolute/path/to/installed-checkout" \
  node "/absolute/path/to/installed-checkout/apps/desktop/node_modules/vitest/vitest.mjs" \
  run --config research/scoped-design-edits/vitest.config.mjs
```

This run used Windows, Git Bash, Node 24.19.0, Vitest 4.1.12 and Biome 2.4.15.
The repository recommends Node 22; this run did not validate Node 22.
The shared base is `4cf33932edc5f687e3cf7190261ebbb02c898d08`.
Generated observations stay in ignored `.Codex/workspace/scoped-design-edits/`.

The test writes `results.json` with every baseline/wrapper outcome and refusal reason.
A normal installed checkout can also run:
```bash
pnpm exec tsc -p research/scoped-design-edits/tsconfig.json
```

## What remains unproven

This edits a source definition, not one rendered instance of a reused component. It does not prove visual parity, support arbitrary CSS/layout changes, or implement batch transactions.
Stable IDs currently come from AST source positions and are valid only for the exact source hash.
Neither file-write races nor UI mapping are exercised here.

## Next experiment

Use 30 representative JSX/TSX designs, including repeated components, computed values and multi-file targets. Freeze a request set and compare the same model's edit proposals with and without a trusted grant, holding prompt/model settings constant. Run three paired trials through the existing pi boundary.

Measure requested-change success, unintended byte changes outside the permitted span, rejection/repair rates, latency and actual token usage separately. Visual correctness requires the repository's supported background verification flow. Investigate legitimate requests that the guard rejects before widening permissions. Do not promote this wrapper into runtime until host-origin and bypass paths are reviewed.

## Research provenance

Conceptual inspiration: [AstraDraw](https://github.com/IamJerryXu/AstraDraw), especially selection and revision-bound local edits.
No upstream code, scenes or assets were copied; the source's overall license was unclear during review.
All added code and fixtures are original under this repository's MIT license.
