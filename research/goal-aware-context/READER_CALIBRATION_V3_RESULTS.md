# Reader contract v3: development calibration

Doubao-Seed-2.0-mini was manually fixed by the user in Ark. Requests used
`ark-code-latest`; the backend version is unknown. This is a development
calibration after inspecting v1/v2 outputs, not a preregistered evaluation.

The 12 independent full-prefix calls completed with valid JSON and state
envelopes. References and exact scoring were unchanged.

| Condition | States | Value/type | Scope | Sources | Invalidation | Joint |
|---|---:|---:|---:|---:|---:|---:|
| All checkpoints | 27 | 25 | 18 | 25 | 26 | 17 |
| Final checkpoints | 9 | 8 | 7 | 8 | 8 | 6 |

Readiness remains **false**. Scope errors include merging `button` into
`field="button.color"`, putting a button object on a file-level preview,
and omitting the field on a workspace-wide rule or an action. Preview
invalidation sometimes omits the later revision's source. Action wording
also differs from approved exact aliases; these remain strict mismatches
pending human review. No aliases, gold states, or historical grades changed.

V3 improves value and joint totals relative to v2, but scope declines
(20 to 18). The calls are unpaired single trials, so these changes do not
establish a reliable improvement.

Freeze `trace-state-reader@3` for the following pressure study. Its results
are diagnostic: report the four axes separately and compare with the
uncompressed control. A failed compressed answer alone does not prove
compression caused the failure. No further reader tuning on this batch.

Local evidence: `goal-20261101/reader-calibration-v3-live-001`, host job
`reader-v3-001`; plan hash
`f37a4be690394cc567a3f4913973ad1c2522857490e10124c840214f746106b9`.
The ignored derived analysis records the SHA-256 of all five raw files and
replays every observation against the frozen scorer without changing grades.
