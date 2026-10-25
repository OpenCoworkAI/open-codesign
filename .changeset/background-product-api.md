---
"@open-codesign/desktop": patch
"@open-codesign/cli": patch
"@open-codesign/core": patch
"@open-codesign/shared": patch
---

Expose core background workflow calls for design creation, workspace editing, generation,
questions, progress events and export. Reuse product handlers with bounded tasks and events,
preserving existing screenshot/action sessions. Keep preview and final verification inside
generation rather than adding separate external operations for them.

Run the core regressions through the original fixture mode and provide an explicitly
opted-in live generation-to-HTML-export acceptance case using the selected stored config.
Keep credential redaction from marking otherwise complete operation results as truncated,
so provider discovery retains a pollable task status.
Preserve raw file content for conditional edits while keeping provider metadata types
and credential redaction intact. Share the static capability catalog between CLI and desktop.
Allow long-running model operations to finish through the debug connection while preserving
the model and session watchdogs.

Record acknowledged user cancellation as informational at the agent and IPC boundaries,
while retaining timeout, upstream and unrelated failures in diagnostics and test reports.
Retry temporary browser-profile cleanup and report persistent cleanup failures as warnings
without replacing the actual design-verification result.
