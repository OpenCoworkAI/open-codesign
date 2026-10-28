# Unified scoring protocol v2

Protocol IDs: unified-context@2 (run) and unified-scoring@2 (scoring overlay). Original corpus protocol goal-aware-context-corpus@2, corpus-evaluation.json and corpus-manifest.json retain their historical bytes and hashes.

## Identity and configuration

For the prepared local development run, the user confirmed Doubao-Seed-2.0-mini was manually selected in Volcano Ark, with no routing to other models. The requested model ID remains ark-code-latest. modelIdentity records displayName, source=user-confirmed, selection=manual-fixed, confirmedAt=2026-10-27 and backendVersion=null. This is user-supplied identity evidence, not an observed immutable server build. Existing endpoint, credential variable names and declared model window are preserved.

Use maxOutputTokens=4096, summaryMaxBytes=1800, timeoutMs=60000, one trial and input tier 2048. Output reserve is config.maxOutputTokens; the original offline corpus protocol's 1024 reserve describes that earlier protocol only. Estimates require explicit allowEstimatedBudget=true and do not prove equal actual token usage. Fixed 1800-byte summaries do not establish a summary-budget curve. Summary size limits apply to the summary string; reported output may also include reasoning.

## User decisions and provenance

The user confirmed “A—D全部接受，E按建议” on 2026-10-27 after seeing development outputs. unified-scoring.json is an evaluator-only overlay containing the exact four approved aliases for s01-c49/scope, seq 48 evidence, question wording overrides, three response-bound human reviews and historical artifact SHA-256 values. It is not independent dual annotation or a preregistered calibration result.

A–D: 调整统计卡片中的数字; 调整统计卡片数字; 统计卡片里的数字; 仅调整统计卡片中的数字. All express the same allowed modification. Other objects, expanded scope and negation do not receive substring-based credit. Text normalization stays NFKC, trim and whitespace folding, followed by exact equality.

E1: wrong field answer instead of scope. E2: key/text instead of revision. E3: bare #317245 instead of a JSON object. Their content is human-confirmed correct; format and overall success fail. Content credit requires matching case/key and the exact historical response ID, request hash, status, parsed value and raw reply. No generic field repair or extraction is permitted. See the JSON record for call IDs and E1–E3 evidence. These reviews do not authorize content credit for future malformed responses.

## Per-question interface and scoring

Compression observations add questions (QuestionJudgment[]); host observations use questions=null and retain their separate fixed rubric. Each judgment contains key, callId, runtimeStatus, runtimeValid, content, format, success, source, reviewId and predicted. Existing score.correct/total/allCorrect now represent overall question success under v2. Reports add questionMetrics (content/format/runtime/overall counts) and reviewQueue with condition, case, method, key and call ID. All counts retain the planned-question denominator.

- content: correct, incorrect, pending-review, unavailable. Well-formed strings use frozen exact answers plus the approved aliases. Unknown malformed replies use pending-review. No usable response, a truncated call or an unexecuted question is unavailable, not semantically incorrect.
- format: pass only for one JSON object with exactly the requested key and a string value; otherwise fail, or not-observed if no usable response exists.
- success: a runtime-valid call with passing format and correct content. Provider overflow invalidates the whole compression condition. Missing, failed, skipped and malformed requests cannot succeed.
- source: frozen-reference, approved-alias, human-review, pending-review or unavailable. Accepted aliases and E reviews identify their review record.

Content and format are diagnostic counts, not proof of task completion. Host-fact and compression groups remain separate. The host gate is not credited as model memory success.

## Prompts and integrity

All compression methods receive identical reader rules: exactly the requested key, one string value, no other keys. Short phrases and “only hex” apply inside the field value. s05-c49/diskColor now asks “当前文件实际按钮色值？JSON 中该字段的值仅填写 hex。” Compressor prompts receive source evidence only. Aliases, accepted answers and human review records never enter model requests.

PreparedUnified adds a scoring policy outside the public plan; sourceHashes.scoring binds its full content. Plan hashes include that digest, original data hashes, effective reader questions/prompts, model config, source implementation and lockfile. Execution rejects modified prepared policies and changes to the current on-disk policy before reading credentials. Old protocol plans must be regenerated.

## Historical derivation and development handoff

unified-rescore.ts reads both pilot runs offline, validates the six original artifact SHA-256 values per run, checks frozen reference hashes and complete compression-condition coverage, then writes new files in an exclusive output directory. It never repairs historical answers. The v2 derived overall scores are 26/40 and 34/40; original strict scores remain 24/40 and 31/40. Historical rescores are post-hoc and are not directly comparable with newly worded prompts as one experimental cohort.

The development template covers 8 development checkpoints, 27 questions and 6 host checkpoints: 22 compressor plus 147 reader calls, maximum 169. Heldout s07-c49/s08-c49 are excluded. A dry-run inspects no credentials, sends zero requests, keeps scores/diagnostic metrics null, and writes empty call/context/observation journals. Each run needs a new output directory. Current source changes invalidate earlier prepared plans, so run a new preflight after code changes.

Suggested offline checks: research Vitest suite; both research TypeScript projects; Biome on touched research files; historical rescore; development CLI without --execute. The real run is started by the user after reviewing the generated config and handoff instructions.
