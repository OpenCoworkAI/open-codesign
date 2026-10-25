# Scope and completion checks before isolated execution

Enable `executionGuard: "enforce-v1"` with the `design-sessions-v1` dataset. The default remains `off`. The guard runs after response-shape validation and **before** the isolated executor applies a proposal; the raw behavior scorer runs separately. Prompts, schemas, case text and answer labels are unchanged from v2. No guard rejection is fed back to the model, retried, repaired or counted as task success.

This is an executable research prototype for an **isolated in-memory object store**. Accepted edits change the store; accepted `done` decisions emit its completion signal. Rejected proposals do neither. It is not yet connected to the desktop agent's file-edit, preview, export or completion tools. It does not demonstrate protection of the production app or real filesystem side effects.

## What the program checks

- Every edit target must exist in the current object inventory and appear in a separate explicit authorization. Existence alone grants no write permission.
- Each field must exist on every target and be allowed by that target's authorization. Multi-target edits are checked in full before any object changes. Duplicate targets/fields and prototype-related keys are rejected.
- The edit's source hash must match current host state. Authorization must match the same design scope, revision and source hash. After an accepted edit, the source hash/revision change and the prior authorization and verification records become stale.
- An `edit` is pending work, not completed work. A non-edit operation must not carry edit targets, changes or a source hash. These are operational contract checks, distinct from JSON syntax.
- A completion claim needs a nonempty host completion policy, zero pending implementation work, and exactly one passing record for every required check. Each record must match the current design scope, revision and source hash. Missing, duplicated, failed, pending or stale evidence rejects completion. A successful build or reachable page cannot replace outstanding visual or site-wide verification.

Validation and commit occur synchronously in the store, with no asynchronous gap between them. Receipts retain allowed/rejected status, explicit reason codes, effect kind, write count and before/after state hashes. The tests verify zero mutation and no completion signal on rejection, including mixed authorized/unauthorized target lists. The store clones host inputs and returned snapshots, so caller mutations cannot silently rewrite its authority.

## Trust boundary and scenario provenance

`execution-guard.ts` accepts a host-owned `TrustedState` and an untrusted proposed decision. It never consults the scorer's `policy`, `positive`, `negative` or accepted-answer fields. The model only produces the existing five-field decision; it cannot supply authorization or passing evidence through that contract. Extra fields claiming to carry evidence fail shape validation.

`guard-scenarios.ts` explicitly reconstructs the host state for the eight development checkpoints. An operator-authored scope grants edits to the navigation label, the two note layouts, or the new note as appropriate; verification-only checkpoints grant no object writes. Required preview/deployment checks are written as structured host obligations. The inventory's field values are representative adapter state, not a rendered artifact or recovered source file; source hashes are constructed snapshot identifiers from this benchmark.

**The guard does not infer these grants from free-form user language.** The reconstructed scopes/check requirements are agent-authored and await human review, just as the corpus labels do. In a real integration, trusted selection/resolution code must supply the scope, and authenticated tool results must supply current verification evidence. A forged or incorrectly specified host snapshot defeats these assumptions. Programmatically checking annotations is not proof that the original user intent was correctly interpreted.

The scenarios were designed after inspecting v2 failures, so v2 replay and new sampling on the same prompts are development/regression evidence, not held-out generalization. The regression tests also rename object IDs, supply stale/missing authority and evidence, and use deliberately incorrect text that remains within scope. This checks generic behavior beyond a list of memorized case IDs.

## What remains outside this guard

It does not compare text to a reference answer, judge design quality, enforce undisclosed metadata enums, require every requested field to have been filled, or detect every unnecessary inspect/ask action. A within-scope rewrite or omitted authorship update can pass this guard and still fail the behavior rubric. Allowing such a proposal is recorded as a residual rubric failure; it is not automatically evidence of a scope/completion vulnerability.

The strict corpus still has the known `user` versus `human` annotation ambiguity. This work does not silently relax that label. The guard also does not automatically normalize unused edit fields; a non-edit response with a source hash is rejected as an operational contract violation even if its high-level next action was reasonable.

## Measurement and reproduction

Use the [guard configuration](./guard-config.example.json), with the already installed 16K aliases from [protocol v2](./PROTOCOL_V2.md). Change only `promptVariant` or the explicit model to compare runs, and use a fresh output directory:

```bash
OLLAMA_LOCAL_TOKEN=local-ollama-placeholder-token corepack pnpm exec tsx \
  research/agent-behavior-evals/model-cli.ts \
  --config research/agent-behavior-evals/guard-config.example.json \
  --output .Codex/workspace/agent-behavior-evals/guard-run-001 --execute
```

Manifests now retain the host snapshots and their hash separately from model requests. Source provenance includes the guard, scenario annotations and shared decision-shape validator. `Observation.guard` is present only for schema-valid responses assessed by the guard. Invalid/missing responses never reach execution and remain in the primary score denominator.

Report independently: raw rubric pass count, rejected failing proposals, rejected passing proposals (false blocks relative to these labels), allowed failing proposals, and rejected proposals with any effects. Do not add blocked failures to model success, call every rubric failure unsafe, or infer completion rate from safe rejection. On this single-step pilot a rejection stops the proposal; correction/recovery is a separate future experiment.

Next integration work: resolve real selection/object IDs into a host-owned authorization; bind preview/deployment evidence to the exact source revision; use the same guard at the real tool commit boundary with transactional execution; then test real tool traces and independent sessions. This prototype does not replace existing app permissions.
