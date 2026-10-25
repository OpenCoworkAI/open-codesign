# Core background workflow API

The background-debug build exposes a small, explicit set of existing product methods.
It supports one workflow: create a design, generate or edit its files, inspect progress,
answer questions or cancel, and export. Generation owns preview and final verification.
Normal builds disable the debug bridge.

## Available operations

| Purpose | Operations |
| --- | --- |
| Design | snapshots.createDesign |
| Model discovery | settings.listProviders (credential-free product view) |
| Workspace | files.read, files.write |
| Generation | generate, cancelGeneration |
| Questions | ask.pending, ask.resolve |
| Observation | chat.onAgentEvent, protocol task/events/snapshot |
| Delivery | export, test.exportDestination |

Configuration mutation/import, clipboard, diagnostics, updates, comments, design renaming,
copying and deletion are outside this API. Standalone preview/verification, file listing,
design details, chat history and global generation status have no dedicated external
operations. Existing UI bootstrap IPC remains available to the renderer; it is not
automatically exposed as callable API operations.

## Session protocol

Use the existing debug session transport described in [BACKGROUND_DEBUG.md](BACKGROUND_DEBUG.md).
The offline command prints the current signatures without launching Electron:

~~~powershell
pnpm cli debug capabilities --json
~~~

JSONL methods capabilities, call, task, cancel and events extend snapshot, act and close.
Arguments follow the selected preload method's positional signature. Each call returns a
task handle immediately; poll task until completed, failed or cancelled before dependent calls.

~~~jsonl
{"schemaVersion":1,"id":"create","method":"call","operation":"snapshots.createDesign","args":["Core workflow"]}
{"schemaVersion":1,"id":"wait","method":"task","taskId":"RETURNED_TASK_ID"}
~~~

Use the returned design ID to read/write files. Conditional writes can pass a fourth argument
{ "expectedContent": "previous full source" }; stale content is rejected by the existing handler.
generate requires fixture or live model mode. Use settings.listProviders to obtain the model
reference and the discovered signature to construct the generation payload. During generation,
poll the generation task and inspect events/snapshot; resolve ask.pending entries with ask.resolve.
The cancel method takes the generation task ID and calls the real cancelGeneration handler.
Other operation tasks are not cancellable.

The agent runs the existing preview and done checks within generation. Task completion,
events, generated files and the session report provide evidence of that workflow.
Screenshot observation and real runtime verification remain separate evidence.

## Export

test.exportDestination takes one absolute path inside the disposable session root, with an
existing parent directory. It supplies the next save dialog result and is consumed once.
Use a path below the created design workspace or another known session directory:

~~~jsonl
{"schemaVersion":1,"id":"destination","method":"call","operation":"test.exportDestination","args":["ABSOLUTE_TEMP_WORKSPACE/result.html"]}
{"schemaVersion":1,"id":"export","method":"call","operation":"export","args":[{"format":"html","designId":"DESIGN_ID","sourcePath":"App.jsx","artifactSource":"READ_BACK_SOURCE"}]}
~~~

Wait for the destination task before exporting, and inspect the export task's real result.
No destination means a cancelled save. Paths are checked again when consumed, including
directory symlink escapes. Native open dialogs, clipboard and shell effects remain blocked.
Browser-dependent exports require an eligible host under the repository's Windows restrictions.

## Bounds and verification

JSONL messages are limited to 32 MiB, individual argument strings to 2 MiB UTF-8, argument JSON
to 28 MiB and task results to 31 MiB. Clipped results carry an explicit truncation envelope.
There are at most eight active tasks and 32 completed results within a 64 MiB total budget.
Events retain up to 256 entries within 512 KiB; inspect dropped-event metadata.
Sensitive fields are redacted; use synthetic content for screenshots and files.

The Node workflow test exercises the real preload, business handlers, workspace and store,
replacing Electron transport at its boundary. It verifies creation, file round trips,
persistence, conflict protection and HTML export. Real Electron/model generation, rendered
preview and browser-dependent export require separate runtime acceptance; Node tests alone
do not establish it.

## Repeatable regression scenarios

The remote model-session branch already provides fixture/live model modes and UI-driven
success, recovery, question and cancellation tests. This local extension adds direct core
business calls and the following API regressions; it does not add more product operations.

| Scenario | Assertions | Execution boundary |
| --- | --- | --- |
| Create, edit, reopen and export | Workspace/store persistence, complete HTML content, cancelled second save | Node, real preload and business handlers with Electron transport replaced |
| Large file and conflicting edits | 96 KiB UTF-8 round trip; stale writes cannot overwrite current content | Node, real workspace files |
| Export failure and external edits | Missing source produces no output; retry uses current disk content; external edits survive a stale write; failures remain in summary | Node, real business handlers/files/exporter |
| API creation to delivery | JSONL call/task, real Electron IPC, HTML file contents, one-use save destination, clean report | Supervised Electron suite |
| API questions and cancellation | Separate cases check answering a pending question and inspecting generated files, and cancelling an active model call with matching events/state/report | Supervised Electron suite, fixture model |
| API generation recovery | Failed task followed by successful generation on the same design; original failure remains in the final report | Supervised Electron suite, fixture model |

Run the Node scenarios with:

~~~powershell
pnpm --filter @open-codesign/desktop test src/main/background-api.workflow.test.ts src/debug/ui-debug.test.ts
~~~

The API session scenarios live beside the original UI tests in
`src/debug/ui-session.integration.test.ts`. On an eligible host, run them through
`pnpm --filter @open-codesign/desktop test:debug-ui`; the supervisor owns the test processes
and lease. `--list` only discovers test files and does not validate a running application.
Ordinary `pnpm test` runs the Node scenarios and excludes the Electron suite.

For a focused supervised run, use `test:debug-ui --test-name-pattern REGEX`. Filtered runs
stop at the first failed test. To retain test transcripts and session reports, set
`CODESIGN_UI_DEBUG_TEST_OUTPUT` to a new absolute directory under `.Codex/workspace`.

## Fixture and live acceptance

Both modes reuse the original `debug session --model-mode fixture|live` host. No additional
model runtime or provider client is involved. Use the existing lease, Windows observer,
permission policy and cleanup checks described in BACKGROUND_DEBUG.md. Rebuild the debug
host when product code changes and use a new output directory for each run.

`fixture` runs the fixed core regressions without real model calls: creation/edit/export,
question/answer through generation, active cancellation, and failure/retry. The controlled
pi replies still drive real tools and browser verification. On an eligible test host:

~~~powershell
$env:CODESIGN_UI_DEBUG_TEST_OUTPUT = (Join-Path $PWD '.Codex/workspace/core-fixture-001')
pnpm --filter @open-codesign/desktop test:debug-ui --test-name-pattern 'core fixture:'
~~~

`live` is explicitly opted in by supplying a selected configuration file. The test invokes
the real configured model through pi, then checks generation completion, App.jsx and DESIGN.md,
standalone HTML export, clean final state, and unchanged source config/credential-file
bytes/mtime. It uses
structural/content checks rather than expecting the model to reproduce the fixture replies.
Question, wait and error fixture markers are not used in live mode.

~~~powershell
$env:CODESIGN_UI_DEBUG_LIVE_CONFIG = 'C:\CoDesign Settings\config.toml'
$env:CODESIGN_UI_DEBUG_TEST_OUTPUT = (Join-Path $PWD '.Codex/workspace/core-live-001')
pnpm --filter @open-codesign/desktop test:debug-ui --test-name-pattern 'core live:'
Remove-Item Env:CODESIGN_UI_DEBUG_LIVE_CONFIG
~~~

Optional `CODESIGN_UI_DEBUG_LIVE_PROVIDER` and `CODESIGN_UI_DEBUG_LIVE_MODEL` forward to the
existing `--provider`/`--model` selection. `CODESIGN_UI_DEBUG_LIVE_CREDENTIAL_STATE` and
`CODESIGN_UI_DEBUG_LIVE_CODEX_AUTH` forward to the original credential options and retain
their restrictions. For Windows safeStorage-encrypted keys, set the credential-state variable
to the source profile's `Local State` before running live acceptance, as described in
BACKGROUND_DEBUG.md. Only the selected stored config/credential is read; no keys belong in
test source, prompts, transcripts or documentation. Live calls consume that provider's quota
and retain the host's call/token/time bounds. Without an explicit live config, the live
generation case is skipped; this is not a successful real-model acceptance.

Record fixture and live results separately. A fixture pass does not establish live success,
and a live success does not replace deterministic failure/cancellation regressions.
