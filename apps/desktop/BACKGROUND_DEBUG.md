# Background debugging of the desktop UI

This development command runs the **real Electron main process, preload bridge, React app,
and local design persistence** in a fresh disposable profile. Puppeteer controls its offscreen
page using the browser debugging protocol. It does not use system mouse/keyboard input.
It requires no API key, existing design, or running desktop application.

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
The command defaults to 120 seconds; `--timeout-ms` accepts 1–3600000. Ctrl+C cancels where
Node receives SIGINT. Cleanup may extend the deadline briefly while processes terminate.

The built-in journey clicks New design, confirms creation, fills the actual composer,
asserts its value, sends Tab inside the page, returns to the hub, and checks the new card.
It also reads the isolated persisted design store to verify exactly one design and a
workspace inside the disposable Documents directory. It does not submit a model request.

The isolated locale is English. The viewport uses the desktop's window dimensions and the
system's device scale factor. Screenshots may therefore be larger than 1280×820 pixels.

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
(visible/text/value). Limits: 1–16 steps, 64 KiB JSON, 256-character selectors,
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
choose the next operation. The CLI itself makes no model calls. Submit **one request at a time**,
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

`act` accepts the same 1–16 preview steps as batch debugging. It stops that request on its
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
ones, and 200 submitted steps. IDs are unique, 1–64 ASCII letters/digits/underscore/hyphen.
Default lifetime is 30 minutes (`--timeout-ms`), default input idle timeout is five minutes
(`--idle-timeout-ms`); both accept 1–3600000 ms. Each action/observation request has a
60-second deadline. Message/queue/request-count limits and idle/lifetime expiry end the session and run cleanup;
requests exceeding the step budget are rejected without executing them.
timeout exits 124. SIGINT/SIGTERM or a broken stdout pipe cancel (130). Input EOF drains
already queued requests and then closes. Stop sending after `close`.

Windows observation runs for the entire session, including time the agent spends thinking.
Live frames have `windows.completed:false`; only the final report can certify the completed
observation. The host checks updates every 250 ms and stops if observation is lost/stale
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

## Windows non-interference verification

Before Electron starts, a hidden PowerShell observer installs WinEvent hooks for visible
window and foreground events, low-level hooks that count injected mouse/keyboard events,
and a periodic visible-window check. It filters window events to the test process and its
descendants. It records **counts**, not typed keys, window titles, or desktop screenshots.
All hooks forward input immediately and are removed when observation ends.

Success on Windows requires completed observation, positive sample count, no overflow,
zero visible test windows, zero test foreground events, and zero observed injected input.
`cursorUnchanged` and `foregroundUnchanged` are informational: you may move your mouse and
switch applications during the run. Those changes do not fail the test. Injected-input
counts are system-wide, so concurrent automation from another program makes that run
inconclusive/failing; they cannot identify which program injected an event.

The observer uses an installed PowerShell 7 when available, otherwise Windows PowerShell.
`CODESIGN_DEBUG_POWERSHELL` can select an executable explicitly. It does not change or bypass
PowerShell execution policy. If the observer cannot start, the command fails before launching
Electron. On other operating systems, the UI flow can run but `windows.available` is false;
no Windows non-interference claim is made.

Offscreen rendering uses Electron's [offscreen rendering support](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering).
`show: false`, `focusable: false`, and `skipTaskbar: true` are applied to the debug window.
The normal ready-to-show/fallback/activation paths do not display it. Attempts to show or
focus it are explicitly blocked and reported. The runner never restores foreground focus
or cursor position; doing so would interfere with the user's own activity.

## Boundaries and failure behavior

- This is an unpackaged development host. The normal desktop launch remains unchanged.
- Each run gets new config, home, Electron user/session data, logs and Documents paths.
  Credentials and Node injection settings are not inherited. Model/OAuth/config-import,
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
  content is not redacted. No real credentials are loaded into this test instance.
- A source fingerprint prevents silently testing an old build. Changes to desktop/shared
  source or build configuration require rebuilding. Test-only edits do not invalidate it.
- Exit codes share the CLI protocol: 2 invalid steps/arguments, 4 setup/stale build/path,
  5 failed UI verification, 6 unsupported host operation, 124 timeout, 130 cancellation.
  JSON stdout contains one envelope; handled run failures retain evidence in `data`.

This first slice does not validate model generation, real provider authentication, native
file dialogs, OS integration, packaged installation, or every application screen. It is
not a security sandbox for untrusted repository code.

## Executable acceptance

```powershell
pnpm --filter @open-codesign/desktop build --mode background-debug
pnpm --filter @open-codesign/desktop test:debug-ui
pnpm --filter @open-codesign/cli test
pnpm lint
pnpm typecheck
pnpm test
```

| Condition | Automated check |
| --- | --- |
| Real renderer/preload/main create a design; actual composer receives input | `ui-debug.integration.test.ts`: default journey and persisted-store assertions |
| Every screenshot is a nonempty PNG with expected minimum dimensions | Integration PNG signatures, IHDR dimensions and size checks |
| No visible test window, focus takeover or injected OS input on Windows | Observer report assertions on success, failure, unsupported and cancelled flows |
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

Real Electron integration is opt-in via `test:debug-ui`; ordinary `pnpm test` reports those
cases as skipped rather than pretending they ran. No test requires real API credentials.
