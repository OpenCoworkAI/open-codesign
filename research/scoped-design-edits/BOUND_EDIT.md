# Host-bound source-edit proposals

The live pilot exposed a Gemma source-hash transcription error. `bound-edit.ts` removes path, AST target ID and hash from model-authored edit arguments. The host captures an immutable `SelectionGrant` from a confirmed source selection and creates a one-use handle. The model submits only that handle, operation kind, field and value.

`createBoundEdit(root, selection)` returns `publicBinding` and `execute(proposal)`. Only `publicBinding` belongs in model context. The executor fills metadata from its captured grant and delegates to the existing disk executor and source-edit engine. It never fills in a newer hash when a file changes. A stale file, foreign/consumed handle, extra metadata field or unauthorized operation is rejected. Incorrect in-scope values are still possible. A handle typo is also rejected; this does not eliminate all model transcription errors.

Seven deterministic tests cover actual accepted JSX writes, an unchanged decoy file, stale files, metadata injection, immutable captured permissions and replay/foreign-handle refusal. These tests are program controls, not additional live-model success measurements. The previous live pilot scores remain unchanged.

This is a research embedding API. Its selection is still host/fixture-supplied, not wired to the desktop selection UI or agent tool dispatch. It inherits the disk harness's single-writer assumption and check-to-rename race limitation. The model cannot choose a different path through this API, but bypasses through other application tools have not been integrated or audited.

The companion `research/goal-aware-context` experiment binds next-step decisions to host-owned document identity, observed file revision, protection requirements and verification evidence. That experiment reads real isolated fixture files and uses simulated tool callbacks; it does not exercise this edit entry point. Keeping these measurements separate avoids claiming that a reader benchmark proves a fully autonomous editing workflow.
