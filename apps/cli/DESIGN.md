# Agent-native CLI: phase 1 design and acceptance

The following describes the offline phase 1 slice. The subsequent `debug ui` development
host and its executable acceptance are documented in
[BACKGROUND_DEBUG.md](../desktop/BACKGROUND_DEBUG.md); it uses real isolated Electron IPC
and does not claim standalone model execution.

## Scope and architecture

The target user is an external agent or developer automating inspection and handoff of
an existing workspace. CI can validate configuration and export known source files.
Full design generation, general CUA, MCP transport, standalone distribution, concurrent
session ownership and interactive login are non-goals of this slice.

```
Node CLI: arguments → deadline/cancellation → operations → versioned JSON/human output
                                               ├─ core/workspace-reader
                                               ├─ core/workspace-inspection
                                               ├─ shared config schema + existing TOML parser
                                               └─ exporters/html → runtime
Desktop: existing IPC → same core reader/classifier and exporters
```

The desktop filesystem reader moves to `packages/core`, preserving its defaults and adding
an optional abort signal for metadata scans, with a compatibility re-export at its previous
location. The pure design inventory classifier is separated from
its pi tool definition, so imports do not initialize pi sessions or providers.
HTML creation remains in `buildInlineHtmlDocument`; CLI operations only validate inputs
and control destination writes. The asset inliner now checks real paths before embedding
assets so a workspace symlink cannot leak an external file into an export.

`main.ts` is an independent Node entry. A small allowlisted Node loader supplies the same
five vendored `?raw` strings that Vite supplies for the desktop runtime. It never evaluates
the browser libraries. No new third-party dependency or lockfile version is introduced:
the new workspace consumes existing core/exporter/shared and smol-toml versions.

For [#274 MCP Server Mode](https://github.com/OpenCoworkAI/open-codesign/issues/274),
future adapters should use these same core filesystem/classification and exporter
functions, and extract a common run host when generation is added. This does not implement
MCP or register a second set of agent tools. The issue remains an open proposal; its
transport, lifecycle and permission decisions are not settled by this CLI.

## Runtime and session blockers

The current production design path is `apps/desktop/src/main/ipc/generate.ts` into
`packages/core/src/agent.ts`. `createCodesignSession` explicitly is not wired to that
flow and its permission extension gates only bash; starting it directly would not
reproduce the application's complete permission and design lifecycle.

Other boundaries that must be preserved:

| Existing boundary | Why it is not used by this CLI |
| --- | --- |
| `auth-bridge.ts` / `keychain.ts` | Electron safeStorage decryption; AuthStorage population writes credential state. |
| `ask-ipc.ts` / `permission-ipc.ts` | User decisions and durable asks currently flow through desktop IPC. |
| `done-verify.ts` / preview | System-Chrome preview/verification is part of successful design completion. |
| `session-chat.ts` / pi SessionManager | Opening sessions can involve file lifecycle/migration; no parallel session format should be invented. |
| `run-journal.ts` | Initialization creates directories, repairs tails and settles interrupted runs; it is not a read-only query API. |
| Desktop index / storage settings | Electron app paths, migrations, logging, IPC and window lifecycle initialize together. |

Next phase: isolate the production run host with injected paths, permission/question
callbacks, credential resolver, verifier, clock and event sink; reuse pi for tool/session
execution. Add an explicitly read-only projection for persisted session/run status that
does not claim an unterminated persisted run is currently alive. Use the same host from
desktop, CLI and future MCP. Test mocked pi/model events, permission denials, cancellation,
durable recovery and terminal state before enabling any CLI model call.
An optional hidden Electron verifier still needs an explicit host lifecycle; a login or
permission flow needing visible interaction must be reported to the caller, not opened
implicitly. The phase 1 CLI returns `UNSUPPORTED` for these paths.

## Executable acceptance

The primary command is `corepack pnpm --filter @open-codesign/cli test`.
Case names below refer to `src/cli.test.ts`; no credentials or GUI are needed.

| Requirement | Executable assertion |
| --- | --- |
| Help | `runs help…`: real subprocess exits 0 and lists commands, JSON, timeouts and exits. |
| Normal doctor | `diagnoses fixtures…`: valid fixture yields versioned checks in JSON and human output. |
| Config failure reasons | `reports missing config…`: missing, malformed TOML and invalid schema produce codes and exit 3. |
| Inaccessible workspace/config | `reports missing/non-directory paths…` and `reports inaccessible config…`: subprocess path errors and injected EACCES produce concrete safe reasons. |
| JSON-only stdout | Subprocess and unit contracts parse the entire stdout; JSON cases require empty stderr. |
| Stable exits | Invalid arguments 2, config 3, real bad paths 4, empty/overwrite export 5, unsupported 6, timeout 124, cancelled 130. |
| Read-only/config reuse | `diagnoses fixtures…` and `uses XDG config lookup…`: before/after content hashes and mtimes for workspace, config and session fixture match. |
| Useful export | `exports HTML and JSX…`: real subprocess writes HTML with doctype, source content, embedded SVG/runtime and correct byte count. |
| Write permissions/failure | `rejects overwrite…`, `blocks traversal…`, `does not write output…`, `removes its partial output…`: protect existing files, paths and cancellation boundary; remove partial writes on failure/cancel. |
| No GUI/input/network | Guarded subprocesses reject Electron, Playwright, Puppeteer, robotjs/nut-js and desktop imports, non-compiler processes and network calls. |
| Unsupported operations | Parameterized `explicitly refuses…` tests run/session/MCP/PDF without GUI fallback. |
| Secret safety | Parser/schema/stored credential/raw-error sentinels are absent from both output streams. |
| Inventory limits | `excludes hidden/internal files…` verifies exclusions and group truncation. |
| Windows paths | Quoted path with spaces preserved by parser; integration tests use temporary paths with spaces. |
| Design execution/model mocks | Not applicable: phase 1 never starts a model or session; unsupported behavior is tested. |
| Existing consumers | Root tests include desktop workspace-reader and core inspect-workspace suites against compatibility exports. |

Run the root `pnpm lint`, `pnpm typecheck`, `pnpm test` checks because multiple packages
are touched. Record exact failures/environment issues; a passing CLI suite alone does not
mean the root checks passed. The contract, permission behavior, timeouts, credential
policy and PowerShell invocation are documented in [README](README.md).
