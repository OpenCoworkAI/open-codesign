# Background debugging of the desktop UI

This development command runs the **real Electron main process, preload bridge, React app,
and local design persistence** in a fresh disposable profile. Puppeteer controls its offscreen
page using the browser debugging protocol instead of calling OS input-injection APIs.
It requires no API key, existing design, or running desktop application.

**Windows status (2026-10-23): partial mitigation landed; non-interference still unverified on an interactive desktop.** A user reported
persistent physical pointer movement while background/model sessions and real browser
tests were running concurrently. It stopped after the owned test processes were terminated.
The observer reported zero injected-input events; those counters did not rule out the
reported movement.

**Likely mechanism (code evidence):** background UI actions used Puppeteer's CDP
`page.mouse.click` (`Input.dispatchMouseEvent`) via `runPreviewSteps` in
`preview-interactions.ts`. On Windows, Chromium can sync the OS cursor for those events
even when the Electron `BrowserWindow` is `show: false` / offscreen, and that path does
**not** set `LLMHF_INJECTED`, so `injectedMouse` stays 0. The Job Object only covers
process lifetime, not desktop/input isolation. Concurrent real Chrome/Electron suites amplify
the risk.

**Mitigations in this tree:** background debug now passes `pointerInput: 'dom'` so clicks
dispatch in-page mouse events instead of CDP mouse; debug windows also use
`setIgnoreMouseEvents(true)`, off-desktop position, and opacity 0. The observer records
informational `cursorJumpSamples` for large single-poll cursor deltas (not a pass/fail gate).
Do not claim verified non-interference until a measured run on an isolated Windows host
passes with no user-visible pointer movement. Prefer not to rerun `test:browser` /
`test:debug-ui` on a busy interactive desktop. Lint, typecheck and ordinary `pnpm test`
(browser suites excluded) can continue.

## Run from the repository root

Use Node 22+ and the repository's pinned pnpm. Build current sources explicitly:

```powershell
pnpm --filter @open-codesign/desktop build --mode background-debug
node --import tsx .\apps\cli\src\main.ts debug ui --output ".\ui-debug-report" --json
$LASTEXITCODE
```

Use a **new output directory** each time; its parent must exist. The report contains absolute
PNG paths, each interaction/assertion result, collected errors, persistence checks, cleanup
status, and Windows observations. `00-initial.png` captures the initial app; a PNG follows
each attempted step, including a failed step. `report.json` remains after cleanup.
The command defaults to 120 seconds; `--timeout-ms` accepts 1â€?600000. Ctrl+C cancels where
Node receives SIGINT. Cleanup may extend the deadline briefly while processes terminate.

The built-in journey clicks New design, confirms creation, fills the actual composer,
asserts its value, sends Tab inside the page, returns to the hub, and checks the new card.
It also reads the isolated persisted design store to verify exactly one design and a
workspace inside the disposable Documents directory. It does not submit a model request.

The isolated locale is English. The viewport uses the desktop's window dimensions and the
system's device scale factor. Screenshots may therefore be larger than 1280Ã—820 pixels.

## Custom interactions

Save `steps.json` using the existing preview step schema:

```json
{
  "schemaVersion": 1,
  "steps": [
    { "action": "click", "selector": "button[aria-label=\"New design\"]" },
    { "action": "assert", "selector": "[role=\"dialog\"]", "visible": true },
    { "action": "press", "selector": "[role=\"document\"] > div:nth-of-type(2) > button", "key": "Escape" }
  ]
}
```

Selectors must match exactly one element. The final step focuses the dialog's folder
button and sends Escape inside the page; it does not open the folder picker.

```powershell
node --import tsx .\apps\cli\src\main.ts debug ui --steps ".\steps.json" --output ".\ui-debug-custom" --json
```

Supported actions: `click`, `fill`, `select`, `press` (Enter/Escape/Tab), `assert`
(visible/text/value). Limits: 1â€?6 steps, 64 KiB JSON, 256-character selectors,
2,000-character text, approximately two seconds per step. The first failed step stops
the journey. Each invocation starts a new instance; this is a batch debugging command,
not a persistent session. Use `debug session` below for an observe/decide/act loop. Screenshots show supplied inputs;
use synthetic test data rather than secrets.

## Continuous sessions for agents

```powershell
pnpm --filter @open-codesign/desktop build --mode background-debug
node --import tsx .\apps\cli\src\main.ts debug session --output ".\ui-session-report"
```

Keep this process and its stdin/stdout pipes open. It starts one disposable app and emits
a `ready` JSON line. An agent reads `data.screenshot`, inspects that PNG using its own vision
capability, and uses `data.elements` (selectors, labels, text, values and disabled state) to
choose the next operation. Model calls are disabled by default; the explicit modes below
enable generation through the app's existing runtime. Submit **one request at a time**,
then wait for its response before making the next decision:

```jsonl
{"schemaVersion":1,"id":"inspect-1","method":"snapshot"}
{"schemaVersion":1,"id":"open-1","method":"act","steps":[{"action":"click","selector":"button[aria-label=\"New design\"]"}]}
{"schemaVersion":1,"id":"inspect-2","method":"snapshot"}
{"schemaVersion":1,"id":"close-1","method":"close"}
```

Those selectors are examples for the initial hub. After the dialog opens, select its Create
button from the new element list, then select the textarea from the workspace response:

```jsonl
{"schemaVersion":1,"id":"create-1","method":"act","steps":[{"action":"click","selector":"[role=\"document\"] > div:last-child > button:last-child"}]}
{"schemaVersion":1,"id":"fill-1","method":"act","steps":[{"action":"fill","selector":"textarea","value":"Background draft"}]}
```

`act` accepts the same 1â€?6 preview steps as batch debugging. It stops that request on its
first failed step. Each action and observation saves a new PNG. State stays in the same
React/main/preload instance until closed. `elements` contains at most 120 visible controls;
covered or inert controls can still appear, and normal hit-testing rejects clicks on them.
Selectors describe the current DOM, so re-observe after navigation instead of treating them
as permanent IDs. Password/sensitive-field values are omitted; textual diagnostics are
redacted, but screenshots are not. Only use synthetic inputs.

Every stdout line is a protocol object, without progress logs:

| `type` | Meaning |
| --- | --- |
| `ready` | App initialized; `id: null`; `data` has the initial screenshot/elements and limits. |
| `response` | Echoes the request `id`; contains a screenshot, steps, new errors since the previous frame, total error count and current Windows observation. |
| `closed` | Cleanup has finished; `id: null`; `data` contains the final report and completed Windows observation. Setup failures may omit `data`. |

Messages retain the CLI's `schemaVersion`, `command`, `ok`, `data` and safe `error` envelope.
A valid `close` receives a response with `{closing:true}` followed by `closed`; wait for
`closed` and the process exit before considering cleanup complete. Setup errors also emit
`closed`; invalid command-line arguments use ordinary CLI error output (`--json` for an envelope).

Malformed requests/duplicate IDs return error 2 without executing an action. A missing
selector returns error 5 and permits another request. Blocked native operations return 6,
and the agent may inspect/recover the UI. Final `report.json` retains all failed attempts,
so the final process exits 5/6 even if later operations succeeded. Protocol-only validation
errors do not mark UI verification as failed. The report never silently discards failures.

Limits: 64 KiB per JSONL message, eight queued messages, 200 requests including malformed
ones, and 200 submitted steps. IDs are unique, 1â€?4 ASCII letters/digits/underscore/hyphen.
Default lifetime is 30 minutes (`--timeout-ms`), default input idle timeout is five minutes
(`--idle-timeout-ms`); both accept 1â€?600000 ms. Each action/observation request has a
60-second deadline. Message/queue/request-count limits and idle/lifetime expiry end the session and run cleanup;
requests exceeding the step budget are rejected without executing them.
timeout exits 124. SIGINT/SIGTERM or a broken stdout pipe cancel (130). Input EOF drains
already queued requests and then closes. Stop sending after `close`.

Windows observation runs for the entire session, including time the agent spends thinking.
Live frames have `windows.completed:false`; the final report records whether observation
completed. The host checks updates every 250 ms and stops if observation is lost/stale
(five seconds), the app exits, or interference is detected. Ordinary user mouse movement
and switching other applications remain allowed. The observer retains only counters after
identifying the test process, avoiding an accumulating history of unrelated desktop activity.

For a PowerShell transport smoke test (three requests, then EOF), use a fresh directory:

```powershell
@'
{"schemaVersion":1,"id":"before","method":"snapshot"}
{"schemaVersion":1,"id":"open","method":"act","steps":[{"action":"click","selector":"button[aria-label=\"New design\"]"}]}
{"schemaVersion":1,"id":"finish","method":"close"}
'@ | node --import tsx .\apps\cli\src\main.ts debug session --output ".\ui-session-smoke"
$LASTEXITCODE
```

Agent clients should spawn Node with `windowsHide:true`, use separate stdin/stdout/stderr
pipes, parse stdout one line at a time, and keep the child handle across tool calls. No
additional listening service, session token, daemon, reconnect or arbitrary JavaScript API
is exposed. Code edits require rebuilding and starting a new session. A debug session is
not a pi design session and does not implement `session status` or MCP issue #274.
The CLI transport calls the same `UiDebugHost`/`UiDebugSession` business interface as batch
debugging, which can also serve a future MCP adapter without duplicating app lifecycle logic.

## Model generation in a background session

Use `fixture` first to test generation without credentials or model network traffic:

```powershell
node --import tsx .\apps\cli\src\main.ts debug session --model-mode fixture --output ".\model-fixture-report"
```

Create a design using the same UI actions above, fill the composer with a synthetic request,
then send `{ "action": "press", "selector": "textarea", "key": "Enter" }`. Observe snapshots
until `data.runs` has a terminal status. The controlled pi model calls the real design tools
to write `DESIGN.md` and `App.jsx`, preview them and finish. Further composer submissions use
the same design's existing session/history. Prefix a request with `[fixture:error]` to test
failure/recovery, `[fixture:ask]` for a real question dialog, or `[fixture:wait]` to exercise
cancellation. These markers apply only to fixture mode.

For an explicitly authorized real provider call, reuse an existing config file:

```powershell
node --import tsx .\apps\cli\src\main.ts debug session --model-mode live --config "C:\CoDesign Settings\config.toml" --output ".\model-live-report"
node --import tsx .\apps\cli\src\main.ts debug session --model-mode live --config "C:\CoDesign Settings\config.toml" --provider my-provider --model my-model --output ".\model-selected-report"
```

Replace example paths and IDs with configured values. Without overrides, live mode uses the
active provider/model. A provider override uses its default model unless `--model` is also
given. No model request occurs until the UI asks for one; submitting a design can also call
the existing title/router models and incur charges. Only that selected provider's config
and credential are projected into memory. The source config is never migrated or saved;
no normal app profile, auth store, workspace or session is attached.

Windows uses the existing Electron safeStorage/DPAPI decryption for stored BYOK credentials.
For a profile-bound encrypted key, also supply the original Open CoDesign instance's
`Local State` file (normally inside its Electron user-data directory; a custom `sessionData`
directory may hold it instead):

```powershell
node --import tsx .\apps\cli\src\main.ts debug session --model-mode live --config "C:\CoDesign Settings\config.toml" --credential-state "C:\CoDesign Profile\Local State" --output ".\model-encrypted-report"
```

This reads only the DPAPI-wrapped `os_crypt.encrypted_key` into a new temporary `Local State`
before Electron initializes safeStorage. It does not copy cookies, preferences or browser
history, attach the original profile, or change either source file. Missing/wrong state
fails explicitly; there is no automatic search or plaintext export of the key. The original
runtime may materialize the selected API credential in its **disposable** auth store; that
store is removed with the temporary instance and never included in evidence.
Plain stored keys also work; keyless providers retain their existing capability rules.
Interactive login, token refresh, non-Windows interactive keychains, credential-bearing URLs,
query parameters and TLS bypass are unsupported. The explicit current-login snapshot below
is supported. Setup failures return exit 3 (configuration) or 6 (unsupported) with a
fixed safe error code. Credentials, ciphertext and configured header values are redacted
from pi responses/errors before they reach app logs, sessions or the renderer. Never put a
secret in the composer: screenshots and generated files are user content, not scrubbed logs.

To reuse an existing **Codex ChatGPT login**, explicitly select its `auth.json` alongside an
Open CoDesign config whose active provider is `chatgpt-codex`:

```powershell
node --import tsx .\apps\cli\src\main.ts debug session --model-mode live --config "C:\CoDesign Settings\config.toml" --codex-auth "$env:USERPROFILE\.codex\auth.json" --output ".\model-login-report"
```

The host converts the selected Codex login into the existing `CodexTokenStore` format in
the disposable profile. It uses only an unexpired access token through the existing pi
subscription wire. Login and every refresh attempt are blocked; expiry within five minutes
fails with `BACKGROUND_MODEL_AUTH_EXPIRED`, without modifying the source login. No normal
profile is attached. This option only permits `https://chatgpt.com/backend-api`, rejects
custom headers/endpoints, and cannot combine with `--credential-state`. Stored tokens are
included in redaction, excluded from evidence and removed during cleanup. Use only a login
whose model access you have authorized; this consumes that account's model allowance.

This mode reuses `codesign:v1:generate`, the production core agent, pi provider streams,
durable run/session lifecycle, tools and preview verifier. The controlled model replaces
only the pi stream; it does not fake IPC responses or renderer state. New commands requiring
permission remain gated; permission approvals, reference-URL capture, attachments, image
generation configuration, native dialogs, config changes and external app opening are not
enabled. A blocked operation is recorded; do not try to approve it through a foreground UI.
There is no standalone `run` command or second MCP/tool implementation.

Limits apply across title/router/generation calls: 24 calls per session, 4,096 output tokens
per call, 60 seconds per call and 180 seconds per generation. These are execution limits,
not a monetary spending cap. The session lifetime and idle deadlines also apply while a
model is running; keep observing it. UI cancellation uses the existing cancel IPC. `close`,
EOF, cancellation or a lost parent abort active calls and await generation settlement before
cleanup. A model that ignores abort is bounded at the pi boundary. Failure to settle during
shutdown is reported; the runner then terminates its owned processes.

Frames and final reports include `model` call counters and bounded event metadata (call
status, history length and whether tools were offered), plus `runs` with actual generation
IDs and terminal states. They contain no prompts, credentials or raw provider payloads.
Before deleting the disposable profile, the runner saves `App.jsx`, `DESIGN.md` and
`index.html`, when present, under `artifacts/<design-number>/`, with byte counts and SHA-256
digests in `report.json` (1 MiB limit per file). Other assets are not exported in this slice.
Require terminal runs, `model.active: 0`, and `cleanup: true` when verifying generation.
Assess Windows non-interference separately: completed observations alone are insufficient.
Preserve failed reports and user-observed interference even after a later recovery.

## Windows non-interference verification

Before Electron starts, a hidden PowerShell observer installs WinEvent hooks for visible
window and foreground events, low-level hooks that count injected mouse/keyboard events,
and a periodic visible-window check. It filters window events to the test process and its
descendants. It records **counts**, not typed keys, window titles, or desktop screenshots.
All hooks forward input immediately and are removed when observation ends.

Passing the automated observation checks requires completed observation, positive sample count, no overflow,
zero visible test windows, zero test foreground events, and zero observed injected input.
`cursorUnchanged`, `foregroundUnchanged`, and `cursorJumpSamples` are informational: you may
move your mouse and switch applications during the run. Those changes do not fail the test.
Injected-input counts are system-wide, so concurrent automation from another program makes
that run inconclusive/failing; they cannot identify which program injected an event.
`cursorJumpSamples` counts large single-poll cursor deltas (possible programmatic/CDP sync
teleports) but ordinary user flicks can also increment it.

These are necessary checks, not proof that the physical cursor never moved unexpectedly.
CDP mouse input can move the cursor without `LLMHF_INJECTED`; background sessions therefore
use DOM pointer input instead. The observer does not attribute cursor position changes to a
process. `report.ok` describes the automated checks; a user's report of interference overrides
it for non-interference acceptance. Close the
owned session, stop remaining owned test processes, save the report/transcript and incident
details, and stop retries on that desktop. Do not move the pointer or restore focus as a
workaround. Run browser suites separately when diagnosing ownership; they are not all
descendants of a background session's observed Electron process.

The observer uses an installed PowerShell 7 when available, otherwise Windows PowerShell.
`CODESIGN_DEBUG_POWERSHELL` can select an executable explicitly. It does not change or bypass
PowerShell execution policy. If the observer cannot start, the command fails before launching
Electron. On other operating systems, the UI flow can run but `windows.available` is false;
no Windows non-interference claim is made.

Offscreen rendering uses Electron's [offscreen rendering support](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering).
`show: false`, `focusable: false`, `skipTaskbar: true`, off-desktop position, opacity 0, and
`setIgnoreMouseEvents(true)` are applied to debug windows. The normal ready-to-show/fallback/
activation paths do not display them. Attempts to show or focus are explicitly blocked and
reported. Background UI clicks use in-page DOM mouse events (`pointerInput: 'dom'`), not CDP
`Input.dispatchMouseEvent`, so the host does not ask Chromium to sync the OS cursor. The
runner never restores foreground focus or cursor position; doing so would interfere with the
user's own activity.

## Boundaries and failure behavior

- This is an unpackaged development host. The normal desktop launch remains unchanged.
- Each run gets new config, home, Electron user/session data, logs and Documents paths.
  Credentials and Node injection settings are not inherited. Except for the explicit selected
  model configuration above, model/OAuth/config-import,
  native dialogs, external opening, clipboard operations, updates and unsupported IPC
  calls are blocked. The supported IPC calls still execute their original validation and
  business logic. Only automatically allocated temporary workspaces may be created.
- Network page requests are blocked. The debug protocol listens on a temporary loopback
  port for the lifetime of this disposable instance; it is not a remote service or MCP
  endpoint. Do not expose or forward that port.
- The runner closes Electron and its child processes, stops the observer and deletes its
  temporary instance on success, failure and handled cancellation. A parent watchdog
  exits Electron if the runner disappears. OS crashes/forced termination can leave temporary
  directories under the system temp folder; an explicit `cleanup: false` requires inspection.
- Runtime exceptions, console errors, failed requests, HTTP error responses, main-log
  errors and blocked host operations are collected with bounded, redacted text. Screenshot
  content is not redacted. Default and fixture modes load no real credentials.
- A source fingerprint prevents silently testing an old build. Changes to desktop/shared
  source or build configuration require rebuilding. Test-only edits do not invalidate it.
- Exit codes share the CLI protocol: 2 invalid steps/arguments, 3 model configuration, 4 setup/stale build/path,
  5 failed UI verification, 6 unsupported host operation, 124 timeout, 130 cancellation.
  JSON stdout contains one envelope; handled run failures retain evidence in `data`.

This development host does not validate interactive authentication, native file dialogs,
OS integration, packaged installation, or every application screen. It is
not a security sandbox for untrusted repository code.

## Executable acceptance

```powershell
pnpm --filter @open-codesign/desktop build --mode background-debug
pnpm --filter @open-codesign/desktop test:debug-ui
pnpm test:browser
pnpm --filter @open-codesign/cli test
pnpm lint
pnpm typecheck
pnpm test
```

| Condition | Automated check |
| --- | --- |
| Default tests reject real Puppeteer launch/connect and override ambient opt-in flags | Desktop/exporter `no-browser.test.ts`; ordinary suites exclude browser/Chrome and Electron integration files |
| Independent browser suites and sessions cannot overlap across worktrees | `scripts/testing/ui-lease.test.mjs`: exclusive lease, inherited suite token and one nested session |
| Windows test descendants exit on root exit, cancellation, timeout or launcher death | `scripts/testing/owned-process.test.mjs`: harmless Node parent/child processes, no UI; includes Unicode/quoted argument round-trip |
| Real renderer/preload/main create a design; actual composer receives input | `ui-debug.integration.test.ts`: default journey and persisted-store assertions |
| Every screenshot is a nonempty PNG with expected minimum dimensions | Integration PNG signatures, IHDR dimensions and size checks |
| No observed visible test window, focus takeover or flagged injected input on Windows | Observer report assertions on success, failure, unsupported and cancelled flows; does not prove absence of physical cursor interference |
| Missing control yields failure and screenshot evidence | Integration exit 5 case |
| Native picker stays closed and UI errors are collected | Integration exit 6 case, rejected IPC and page error |
| Cancellation closes processes and removes temporary state | Integration cancellation after first screenshot; `cleanup` assertions |
| Observer survives a briefly locked PID marker | Windows sharing-violation regression in the integration suite |
| Config and environment secrets remain isolated | Integration config digest/sentinel checks; unit environment allowlist and redaction checks |
| Stale source cannot be silently validated | Source-fingerprint unit test and runtime preflight |
| Normal launches and model permissions stay unchanged | Host-policy tests, existing desktop tests, build/typecheck |
| JSON contracts and timeout exit preserve evidence | CLI contract tests |
| One real app retains input across separate requests; failed clicks allow correction | `ui-session.integration.test.ts`: continuity/recovery case |
| Rejected native operations are visible before close; EOF cleans up | Session integration unsupported/EOF case |
| Idle timeout and lost stdout close the app and preserve final evidence | Session integration idle/output-disconnect cases |
| Loss of the owned Windows observer stops an idle session instead of claiming success | Windows-only session integration observer-disconnect case |
| JSONL framing, UTF-8 splits, duplicate IDs, malformed/overlarge input, queue limits, cancellation | `apps/cli/src/ui-session.test.ts` |
| Model options are explicit and invalid combinations return usage errors | `apps/cli/src/model-options.test.ts` |
| Only the chosen provider/credential is projected; invalid config never echoes secrets | `model-config.test.ts` |
| pi calls enforce selection, call limits, secret redaction and bounded cancellation | `model-stream.test.ts`, including a provider that ignores abort |
| Actual generation writes valid files, previews, settles and continues with session history | `ui-session.integration.test.ts`: controlled generation and second turn |
| Failed generation recovers; ask UI answers reach the runtime; EOF aborts an active model | Controlled failure/recovery, question and cancellation integration cases |
| Live setup preserves source bytes/mtime and never exposes synthetic credentials | Live-config startup integration case (no network request) |
| Missing live config exits 3 with cleanup and no GUI fallback | Missing-config integration case |
| Encrypted-state projection excludes unrelated profile data; malformed state never opens an error dialog | `credential-state.test.ts` and invalid-state integration case, including source bytes/mtime |
| Current login requires explicit selection, unexpired tokens and the official endpoint; refresh is denied | `model-auth.test.ts`, `model-config.test.ts`, `codex-oauth-ipc.test.ts` |
| Login setup makes zero model calls and leaves source login/config bytes and mtimes unchanged | Current-login session integration case with synthetic tokens |

`pnpm test` runs ordinary tests, including the process ownership checks with harmless Node
children. Real Electron files are excluded; browser/Chrome files are excluded, and the mixed
HTML/ZIP portability cases are skipped. File-local Puppeteer mocks remain usable; an
unexpected real launch/connect fails with `REAL_BROWSER_DISABLED`. Browser-heavy preview,
research and workspace verification cases live in explicitly named `.browser.test.ts` files.
No test requires real API credentials. A passing ordinary run does not validate UI behavior.

On an eligible host, `pnpm test:browser` runs desktop then exporter browser suites, one worker
and one file at a time. `pnpm --filter @open-codesign/desktop test:browser` and
`pnpm --filter @open-codesign/exporters test:browser` select one package.
`pnpm --filter @open-codesign/desktop test:debug-ui` runs the real Electron cases serially.
CI/release explicitly run browser coverage after ordinary tests; browser results are not
cached by Turbo. These commands work as written in PowerShell; no inline shell environment
assignments are required. The Windows incident restriction above still applies.

For a safe inventory without importing or executing test files, use `pnpm test:browser --list`
or `pnpm --filter @open-codesign/desktop test:debug-ui --list`. These run Vitest's
`list --filesOnly` under the same lease/supervisor. Their reports have `listOnly: true` and
must not be counted as passing browser or Electron tests.

The runner writes `.Codex/workspace/ui-tests-*/report.json` with package, root PID, ownership
mechanism, exit code and cleanup result. Each package has a 30-minute deadline (124 on
timeout, 130 on cancellation); ordinary test failures retain the child's exit code. On
Windows a hidden PowerShell helper creates the Node child suspended, assigns it to a
kill-on-close Job Object, then resumes it. The job covers descendants even if the test root
has already exited. Cancellation/parent pipe loss closes the job. PowerShell policy is not
changed; PowerShell 7 is preferred when installed or available on PATH, with Windows
PowerShell as the fallback. `CODESIGN_TEST_POWERSHELL` may explicitly select an executable;
an invalid selection fails rather than silently falling back. Policy restrictions or
inability to create the job fail before tests run. Child tests read EOF from NUL, not the
control pipe or a keyboard. Per-package `.log` files retain stdout/stderr beside the report.
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) manage lifetime,
not screen/input isolation. On POSIX the runner kills its process group; separately detached
process groups are outside that guarantee, and abrupt runner death is not covered.

Browser suites and direct background sessions share a per-user lock under the OS temp
directory, independent of checkout. Suite children inherit a lease token; only one nested
session can run. Raw browser/debug Vitest configs reject invocation without the supervisor.
The lease is released only after reported cleanup; an interrupted owner may leave a stale
lease deliberately. Inspect its `owner.json`, the run report and owned processes before
removing **that exact directory**; never kill all Chrome/Electron processes or automatically
steal a lease merely because its root PID exited. To print the lock location without opening
an application, from the repository root:

```powershell
node --input-type=module -e "import { uiLeaseDirectory } from './apps/desktop/src/debug/ui-lease.mjs'; console.log(uiLeaseDirectory)"
```
