# Evidence-aware candidate selector

This Task3 prototype is a **draft oracle state-only ablation**. It consumes privileged state annotations derived from source prefixes. Those annotations are AI drafts pending human semantic review. It is not natural-language extraction, a production memory store, a fair information-matched model comparison, or evidence of model-quality improvement.

## Contracts and authority

goal-state.ts adds explicit category, slot and replaces fields to the planned record. A stable slot describes one decision dimension. Replacement/revocation/resolution links must target earlier records of the same design, kind, slot and category. Invalid/missing/forward links fail. Input order is irrelevant. Conflicting surviving alternatives remain unresolved until explicit resolution. Revocation tombstones remain visible until superseded; old facts cannot reappear as active.

The reducer takes bounded evidence rows and a cutoff in addition to design/current revision. Direct user rows can support intent. A completed read with matching observed revision can support a file fact. A completed preview with matching revision and zero errors can support verification. Failed tools and assistant completion claims do not confer those authorities. Stale file/verification records are excluded rather than reclassified as user intent. Current tool evidence schemas here are synthetic fixture contracts; actual pi/workspace event normalization belongs to later integration. ask-result intent authority is not supported yet.

These checks prove source role, existence, ordering and version consistency, not semantic entailment of arbitrary annotation text. Annotation correctness and scope completeness require the review in [ANNOTATION_REVIEW.md](./ANNOTATION_REVIEW.md). Actual files/visual correctness remain downstream work.

## Candidate pack and budget

candidate-pack.ts reuses the production pack to format host workspace/resource/preferences state, removes its cached brief and history, clears lastDone, then adds whole selected state records through the existing escaped untrusted-context boundary. It does not concatenate raw conversation back into this state-only condition. The original production input is unchanged.

Priority: unresolved/revoked state, goal, scope/constraints, unfinished tasks, decisions, file observations, verification; newer records break ties. No text/evidence qualification is truncated. Omitted record IDs are explicit. If unresolved/revoked state cannot fit intact, the entire condition falls back.

The selector sees fixed system/tool framing and a declared reader-question reserve only, never withheld questions or answers. Both input-tier and model-window capacity are reduced by that reserve before complete-envelope measurement; output reserve remains separate. This is a question-reserved preflight, not proof every eventual reader request fits. The later runner must measure each full actual request, retain one frozen context, and mark the whole condition invalid on any question overflow.

Empty/invalid state, unavailable counter, overflow or counter error returns the exact original production pack with mode fallback and an explicit reason/detail. The fallback is measured where possible and may itself overflow. It is never counted as a candidate success or automatically sent to a model.

## Frozen development drafts

annotation-drafts.json contains 52 records across 8 development checkpoints, each bound to the existing frozen input hash. All are needs-human-review and reviewedByHuman=false. The old dashboard palette/font/layout applicability to the new report is explicitly unresolved, pending R5 in the review checklist. Source rows/checkpoints, Task2 references and the reserved heldout inputs are unchanged. No new heldout annotations are created.

The annotation loader validates development-only coverage, input fingerprints and evidence. It validates the corpus/protocol/input part of the manifest without loading evaluator answers; the unchanged Task2 audit validates evaluator hashes separately. The offline runner reads no evaluator file. Synthetic workspace revision strings map explicitly to their tool revision suffix; this is fixture normalization, not filesystem verification.

run-candidate-state.ts freezes each context using a condition digest that includes scope/annotation data, known research/core/shared implementation text and lockfile, budget, fixed framing and counter version. It produces 24 conditions (8 checkpoints times 3 estimate tiers), with full selected/excluded/omitted records, fallback metadata and frozen pack hashes. There are zero model calls and no answer scores.

~~~bash
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json \
  research/goal-aware-context/run-candidate-state.ts \
  .Codex/workspace/goal-aware-context/state-run-001/report.json
~~~

Use a new output path; existing files are refused. Review semantics before treating drafts as an oracle upper bound. Next comes natural-language extraction/model evaluation on development data, with sealed references and actual usage; no product defaults or persisted V1 schemas change here.
