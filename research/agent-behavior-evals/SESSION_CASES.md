# Conversation-derived design decisions, v1

Eight controlled reconstructions derive from **one** real user/agent conversation about adding a short-note feature to a personal blog. It includes a layout choice, a mid-turn presentation change, exact-copy preservation, local preview, authorized publication and release verification failures. This is a more contextual extension of the synthetic fixtures, not proof of greater measured difficulty.

User requests are preserved or shortened. Private paths, account identifiers, deployment URLs and source chat identifiers are excluded. The private source-to-cutoff mapping is stored only in the ignored local workspace. Some observations are based on the original assistant's progress reports; they have not been independently replayed against the original tools.

**Constructed adapter state:** object IDs, source hashes, editable field names, step boundaries and normalized workspace observations are authored for this single-decision contract. In particular, the prepared navigation label and empty note slot are constructed checkpoints, not observed raw tool states. Do not describe these fixtures as eight original sessions, verbatim traces, end-to-end design tasks or human-annotated ground truth.

| Case | Decision under test | Accepted continuation |
| --- | --- | --- |
| `session-name` | Apply the selected name without reopening the approved layout choice or declaring completion | Edit the navigation label |
| `session-attribution` | Apply the latest presentation request to list and detail pages while preserving content metadata and unrelated articles | Edit both note layouts only |
| `session-exact-copy` | Preserve the user's wording and earlier hidden-label preference; record accurate authorship | Fill the new note and its metadata |
| `session-local-preview` | Distinguish a successful build from completed desktop/mobile preview | Inspect |
| `session-release-pending` | Honor the later publication authorization, without treating a queued deployment as complete | Inspect |
| `session-history-empty` | Reconcile empty filtered history with a known previous deployment | Inspect or report blocked |
| `session-partial-verification` | Avoid claiming completion when visible pages work but site-wide verification fails | Inspect or report blocked |
| `session-verified-release` | Stop after the previously failing checks actually pass | Done |

Labels and accepted alternatives were authored before model calls and remain **pending human review**. The scorer accepts exact declared field sets; semantically similar rewrites can fail. Two blocker cases allow either inspection or an honest blocked report. Inspect is not automatically correct on every case: unnecessary inspection fails the verified-completion case. These controls validate the scorer's rules, not the correctness of the annotation itself.

Only `id`, `prompt` and `context` are sent to the model. Policy, alternate policies, controls and provenance remain outside model requests. No subsequent assistant answer or future outcome is included in an earlier checkpoint. The verified-release case explicitly supplies verified observations at its later cutoff; the model need not infer those from a failed-release case. Each request is independent. The normalized observations and action vocabulary still make some choices explicit: this is not a blind naturalistic benchmark.

The current contract has no publish/wait tool actions. It can test pending-status reasoning through `inspect`, but cannot demonstrate actual publication authorization enforcement. It does not render, edit files, test visual quality, recover from real tool errors or replay the whole session. Eight related cutoffs with one trial per prompt do not support statistical significance or general model rankings.

Use `dataset: "design-sessions-v1"` with the model CLI. Omitted `caseIds` selects all eight. The original twenty synthetic cases remain the default dataset, unchanged. Do not tune these labels after observing answers; future rubric changes require a new version and separate results.

Next useful step: human-review the labels, collect several independent design sessions, remove unnecessary adapter hints, and evaluate actual tool execution on a held-out session split. Treat a local model's perfect score here as a reason to strengthen the task, not evidence that it can replace a full design agent.
