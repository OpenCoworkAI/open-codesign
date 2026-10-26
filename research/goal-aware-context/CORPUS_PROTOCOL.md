# Corpus and comparison protocol v2

This is research infrastructure. It does not change application behavior or pi compaction.

## Materials and what they can establish

The committed corpus contains **8 original synthetic sessions, 400 chat rows, 10 checkpoints and 35 reference questions**. corpus-inputs.json contains source chat and as-of snapshots only. corpus-evaluation.json contains evaluator-only questions, accepted structured answers, evidence sequence numbers, subsequent edit requests and required checks. These references were authored separately from the production pack/compressor, by the same research author; they are **not independently human annotated real-session truth**.

There are 6 development sessions (8 checkpoints) and 2 reserved heldout sessions (2 checkpoints). s01 and resumed s02 share a design and stay together. All source-session aliases and transitively linked designs must stay in one split. The reserved examples were visible to their author: this is a protocol holdout for later compressor tuning, not a blind external benchmark. Repeated filler creates distance but little realistic topic diversity. Synthetic scores cannot establish generalization, model gains, statistical significance or readiness for production.

| Cases | Main check |
| --- | --- |
| s01-c3 / c45 / c49 | Three sequential checkpoints; early decisions, later reversal, persistent scope; c49 deliberately reuses an older cached brief |
| s02-c49 | Resumed design, new active goal, paused work, local financial-data boundary |
| s03-c49 | Design switching; do not import another design's palette or change other steps |
| s04-c49 | Preview failure after revision changes; old success and assistant completion claims are insufficient |
| s05-c49 | External edit; approved user intent differs from observed file state |
| s06-c49 | Explicit unresolved conflict and a file containing a false instruction |
| s07-c49 | Chinese/English, emoji and a scoped text change |
| s08-c49 | Revoked preference, unapproved assistant proposal, remaining constraints |

Workspace revisions here are **synthetic identifiers**, not real on-disk source hashes. Actual source-file/preview validation belongs to the downstream-edit step. Snapshots are explicitly supplied fixture inputs, not measured outputs of a production brief-generation model. A cached brief may be stale; it is intentionally not repaired with reference answers.

## Freeze and leakage boundaries

corpus-manifest.json pins canonical SHA-256 hashes of the protocol, corpus, evaluator references, and every projected input, plus each checkpoint's split. Formatting and JSON key order do not change the hash. Changed content, split coverage, duplicate cases, unknown cases or connected-family leakage fail validation. A new corpus/protocol version and reviewed manifest diff are required for intentional changes; never regenerate hashes merely to silence a failure.

Rows have unique IDs and increasing sequence numbers. Each checkpoint must end on a known row; snapshot capturedThroughSeq cannot exceed its cutoff. createCorpusInput() projects the row prefix and its own snapshot. getCompressorInput() returns a detached, validated BuildDesignContextPackInput only: no questions, answers, evaluation categories, next edit or required checks. The runtime cannot prove that a human snapshot was not secretly written using future knowledge: as-of source provenance is also an annotation-review obligation.

Run compression once for each input/condition/trial **before revealing any questions**. Freeze the resulting context and use it for every question at that checkpoint. freezeContext()/reuseContext() bind it to the entire input, cutoff, workspace revision, condition identifier and its own content hash. Future runners must use a condition ID incorporating a digest of compressor implementation, prompt/model/settings, budget and counter version; an unchanged display name is insufficient. Do not recompress, retrieve different source facts or repair state per question.

The evaluator and compressor may share a research process, but this interface is not an OS security boundary. A model compressor must receive only the projected input and compression instructions, with no filesystem tools that can read evaluator files. For a real blind run, keep sealed references outside the compressor's accessible directory/process and record their hash before tuning.

## Frozen comparisons

COMPARISON_PROTOCOL in corpus.ts is the machine-readable source of these settings:

- Full context: the entire prefix plus the same as-of state, subject to the model's actual context window. Record overflow; do not truncate and still call it full context.
- Production raw: call the existing buildDesignContextPack unchanged and retain its complete output/trace. Its history character budget does not bound the complete model request.
- Production budget matched: adjust the supported history limit until the **complete** request fits the selected input budget. Respect existing clamps. If no setting fits, record overflow; no hidden extra truncation.
- Candidate budget matched: use the same projected input and the same complete input limit. A fallback remains a recorded fallback, not candidate success.
- Recency packing remains an optional explanatory ablation, separate from the production baseline.

Input tiers: **2,048 / 4,096 / 8,192 tokens**, with **1,024 output tokens reserved**. Effective input limit is min(input tier, model context window - reserved output). Full-context reference is a ceiling and need not fit a compressed input tier; it must fit the real model window. Keep reader model/version, settings, task prompt and tool definitions identical across paired conditions. Freeze the concrete model and full rendered prompts in the later model-run manifest before tuning; they are not selected by this offline protocol step.

Count the complete request: system/task instructions, brief/workspace/context sections, history, tool schemas, current reader question and model-specific framing. If questions differ in length, use one frozen context sized for the worst question; any question overflow invalidates that checkpoint/condition at that tier. Do not silently shorten context for just that question.

measureRequest() accepts an injected, versioned counter for this text-only envelope. Its tokens claim must be justified by a documented model-compatible tokenizer including framing; the helper itself does not certify a tokenizer. Unsupported multimodal/provider fields need an extended envelope/counter before model use. No tokenizer dependency is introduced here. estimateUtf8QuarterTokens is exactly ceil(UTF-8 bytes(JSON request)/4) and reports **estimate**, never actual tokens. The audit uses synthetic system/tool framing, so it is not a measurement of the complete product/provider request.

Missing/null/failed counters report count: null, unit: unavailable, with an error where available. assertWithinBudget() rejects unavailable counts, preflight overflow and provider-reported input overflow. Provider input/output usage is copied and recorded separately, including contradictions with estimates. Never overwrite a preflight estimate with actual usage or mix estimates and exact counts in one equal-token comparison. Report actual provider usage, model/parse/tool failures, latency, compression+reader costs, fallback and output truncation separately in the later runner; unknown values remain unknown.

## Scoring and reporting

Reader output is structured question key to answer string. Questions specify concise answer forms; evaluator-only aliases are frozen in advance. scoreAnswers() applies Unicode NFKC normalization, trimming and whitespace folding, then exact matching. It does not accept a correct value merely contained in a longer, contradictory answer. Missing answers fail; extra keys or non-string values are invalid output. A trivial reader that copies single-answer instructions from the question must score zero; this catches direct answer disclosure, not every possible no-context shortcut. Hex color casing variants and limited source-supported phrases are explicitly frozen aliases. Do not add aliases or use an LLM judge after seeing candidate predictions without versioning the protocol and rescoring all paired conditions.

Primary metrics are per-question accuracy and all-questions-correct per checkpoint. Report each session/checkpoint and each category before aggregates. Failures must remain in the attempted denominator and be reported by type; valid-only accuracy is secondary. Do not claim task completion from remembered answers: subsequent edit violations and all-requirements completion require observed files/tool events in the downstream step.

Run three trials per real model condition. Trials and multiple checkpoints are repeated observations, not independent samples. Pair comparisons by session and aggregate uncertainty by connected session/design family. Keep development and heldout results separate. Do not tune prompts, thresholds, aliases or select models on heldout results; after inspecting them for tuning, retire that holdout version. The tiny synthetic split supports protocol regression checks only.

## Intake of real sessions

Target the planned 20 consented, redacted multi-turn sessions before making real-session quality claims.

1. Obtain permission and rights for research/publication as appropriate. Preserve a private consent reference, never raw identity or credentials. Use stable pseudonymous source-session/design identifiers; declare related designs and resumed sessions.
2. Export the original chronological rows. Redact keys, personal data, financial details and local paths consistently; preserve decision semantics. A second reviewer records the redaction review. Never publish raw private logs to this repository.
3. Choose cutoffs without seeing candidate outputs. Capture brief, resource/preferences/workspace state as actually available at each cutoff; record snapshot source sequence and actual source-file revision hashes. Later history and future edits remain evaluator-only.
4. Two independent annotators identify active goals, confirmed/rejected/revoked decisions, scope, unresolved conflicts, stale observations and unfinished work. Each answer cites available rows/files; adjudicate disagreements without inventing approval. Record reviewer/adjudication references in the private intake record. The shipped synthetic-author-reviewed reference file is not suitable for claiming this standard.
5. Replace/add real data under a new corpus version. Extend the reference metadata to enforce the real annotation record, check all group connections, freeze split/hashes/questions/edit tasks/metrics, then tune on development only. Keep restricted data out of public Git; publish only licensed, explicitly approved redacted examples or hashed manifests.
6. Record exclusions and coverage gaps (language, length, number of compressions, tool failures, external edits). With fewer or biased sessions, report the limitation and collect more data rather than promote a default.

## Reproduce the offline audit

With the Node 22 / frozen pnpm installation described in the README:

~~~bash
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json \
  research/goal-aware-context/run-corpus-protocol.ts \
  .Codex/workspace/goal-aware-context/protocol-run-001/report.json

node packages/core/node_modules/vitest/vitest.mjs run \
  --config research/goal-aware-context/vitest.config.mjs
pnpm exec tsc -p research/goal-aware-context/tsconfig.json
pnpm exec biome check research/goal-aware-context
~~~

Choose a new output file; existing evidence is refused. The audit checks source/reference/split hashes, runs the unchanged production pack on every prefix, freezes each pack before iterating questions, and reports estimated complete-envelope counts for all three tiers. It performs zero model calls, reads no credentials, assigns no quality scores, and does not simulate successive model-generated summaries.

## Protocol revision record

The initial local v1 audit was superseded before any model run. Independent review found 9 questions disclosed their sole answer in a response instruction; a no-context copying reader scored 9/35. In v2 these instructions are neutral, aliases are frozen before model output, and the same copying reader must score 0/35. Request boundaries also reject unsupported fields. The original audit/RED logs remain local evidence, not final evaluation results.
