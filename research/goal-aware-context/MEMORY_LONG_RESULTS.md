# Long/repeated results — 2026-11-01

Diagnostic development study, protocol trace-state-memory-study@1, reader
trace-state-reader@3. Model Doubao-Seed-2.0-mini manually fixed by the
user in Ark; request alias ark-code-latest, backend version unknown.

Planned 84 calls; actual 78. Worker exit2,
status incomplete. Every planned probe remains in the denominator.
Output4096, memory1800 UTF8 bytes, reader input2048 estimated tokens,
timeout60s, no retries. Full-prefix control input ceiling8192; 2 derived56-event histories, 3 trials, final probes only.

## Final states

| Condition | Value/type | Scope | Sources | Invalidation | Joint |
|---|---:|---:|---:|---:|---:|
| ordinary-summary/3 | 6/15 | 2/15 | 0/15 | 6/15 | 0/15 |
| goal-record/3 | 12/15 | 3/15 | 0/15 | 9/15 | 0/15 |
| stable-handoff/3 | 7/15 | 3/15 | 5/15 | 5/15 | 1/15 |
| goal-recall/3 | 15/15 | 9/15 | 12/15 | 12/15 | 8/15 |
| full-prefix/0 | 15/15 | 8/15 | 12/15 | 11/15 | 6/15 |

## Runtime and format

| Condition | Calls actual/planned | Final valid/planned | All observed statuses |
|---|---:|---:|---|
| ordinary-summary/3 | 18/24 | 3/6 | blocked-by-prior-summary:2, length:1, ok:3 |
| goal-record/3 | 24/24 | 5/6 | ok:5, length:1 |
| stable-handoff/3 | 24/24 | 3/6 | ok:3, length:3 |
| goal-recall/3 | 6/6 | 6/6 | ok:6 |
| full-prefix/0 | 6/6 | 6/6 | ok:6 |

## Per-family/trial joint scores

| Family/trial | ordinary-summary | goal-record | stable-handoff | goal-recall | full-prefix |
|---|---:|---:|---:|---:|---:|
| long-version-facts/trial-1 | 0/3 | 0/3 | 0/3 | 2/3 | 2/3 |
| long-version-facts/trial-2 | 0/3 | 0/3 | 0/3 | 2/3 | 0/3 |
| long-version-facts/trial-3 | 0/3 | 0/3 | 0/3 | 2/3 | 0/3 |
| long-correction-new-design/trial-1 | 0/2 | 0/2 | 0/2 | 1/2 | 1/2 |
| long-correction-new-design/trial-2 | 0/2 | 0/2 | 0/2 | 1/2 | 2/2 |
| long-correction-new-design/trial-3 | 0/2 | 0/2 | 1/2 | 0/2 | 1/2 |

## Interpretation boundaries and audit

All55 value/type claims from the23 format-valid probes were correct. The
remaining20 claims stay failed in the primary75-state denominator. This
conditional diagnostic does not replace the strict scores or reveal the
semantic content of truncated/blocked answers; value-score differences here
primarily reflect runtime/format losses, not demonstrated value forgetting.

- Full-prefix v3 calibration itself had final joint6/9 and readinessfalse.
  A compressed failure alone does not establish compression-caused forgetting.
- Scope and original evidence are independently scored; matching a value
  does not establish a fully correct state. Unknown wording stays strict
  mismatch pending review. No response extraction, repair or new aliases.
- Archive recall can reread the original prefix; closed summaries cannot.
  Archive scan/selection IDs, memory bytes and elapsed wall time are logged.
  Handoff changes instructions as well as memory organization.
- Trials are descriptive repeats of two synthetic core families. Fixed call order and unknown backend seeds/version do not support significance or superiority claims. Long histories are bounded relative to the reader budget, not full model-window exhaustion.
- Wrapper token/cost usage may omit cache reads. Estimates are not exact
  equal-token comparisons or verified billing. Truncated call usage/status
  is retained; partial text is unavailable through the pi length-error boundary.
- Reader failureCause can be null; status and call journals preserve the reason.
  Selector correction bundling is heuristic; broader quality remains unproven.

Offline audit reproduced every score, verified 50 compressor inputs,
28 reader inputs and 18 recall updates, plus
78 recorded request intents. Previous memory and delta match their
own chain; probe answers never feed later compression. All five raw files
have SHA-256 records; score changes0.

Local ignored evidence: goal-20261101/memory-long-live-001 and
analyses/memory-long-001/analysis.json. Plan hash:
f447bf5183ccb1112bfe2c37946ee1e26c59cd8f46f5d9ffed13f30c8b9f1509. 0 distinct strict value mismatches are saved
with raw evidence for possible human review, without changing these scores.
