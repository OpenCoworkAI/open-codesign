# Open CoDesign CLI

A source-checkout CLI for agents, developers and CI. It inspects existing workspaces and
exports HTML directly through Open CoDesign's core and exporter packages. The desktop app
does not need to be running. Inspection and export use no model, browser or Electron.
The development-only `debug ui` command separately starts an isolated offscreen Electron
instance to verify Open CoDesign's own interface without physical desktop input.

## Run

From the repository root, use Node.js 22+ and the pinned pnpm version:

```sh
corepack pnpm install --frozen-lockfile
node --import tsx apps/cli/src/main.ts --help
node --import tsx apps/cli/src/main.ts doctor --workspace . --json
node --import tsx apps/cli/src/main.ts workspace inspect --workspace . --json
```

`doctor` returns exit 3 if no config is present. Inspection and export work without config.
`corepack pnpm --silent cli` (or `pnpm --silent cli`) is a convenience alias.
Use `--silent` to suppress pnpm's script banner, but use the direct Node entry for
automation: pnpm's script runner can normalize all failures to exit 1. JSON still contains
the CLI's original `error.exitCode`. There is no globally installed `open-codesign` binary
in this phase.

Windows PowerShell examples (replace the example design paths with your own):

```powershell
node --import tsx .\apps\cli\src\main.ts doctor --workspace "C:\Design Work\Demo" --config "C:\CoDesign Settings\config.toml" --json
node --import tsx .\apps\cli\src\main.ts workspace inspect --workspace "C:\Design Work\Demo" --json
node --import tsx .\apps\cli\src\main.ts export html --workspace "C:\Design Work\Demo" --source "App.jsx" --output "C:\Exports\demo.html" --timeout-ms 30000 --json
$LASTEXITCODE
```

The destination parent directory must already exist. Use a new output filename on each run.
`--source` can be a workspace-relative `.html`, `.htm`, `.jsx` or `.tsx` file, including
a nested path. It must be UTF-8 text, at most 2 MiB, and cannot be hidden or traverse
symlinks/junctions. It is selected explicitly; the CLI does not guess which design to export.

## Commands and effects

| Command | Behavior |
| --- | --- |
| `--help` / `help` | Commands, options and exit codes; supports `--json`. |
| `doctor` | Node version, config schema, credential storage summary, workspace scan and HTML dependency availability. Human output by default. |
| `workspace inspect --workspace PATH` | Bounded design inventory: entry candidates, sources, styles, design/reference documents and assets. No file contents. |
| `export html --workspace PATH --source FILE --output FILE` | Reuses the existing standalone runtime and HTML exporter; creates one new output file. |
| `debug ui --output NEW_DIR [--steps FILE]` | Real desktop UI in offscreen Electron; screenshots, interactions, errors and Windows non-interference observations. Requires a fresh debug build. |

Inspection skips hidden/internal/build directories and symbolic links using the desktop's
same filesystem reader. It scans up to 2,001 files, reports at most 2,000 files, up to 24
items per group and eight entry candidates. `truncated: true` means the inventory or a
group is incomplete; `totalFiles` then describes the inspected subset, not the whole tree.

Export inlines supported local assets. Assets resolving outside the workspace through
symlinks/junctions are not embedded. Missing/unresolved local references remain unchanged,
as do remote URLs. Export does not fetch resources, execute scripts, validate application
imports, or visually verify the result. It supports the same standalone JSX/TSX snippets
as the desktop exporter, not arbitrary bundler-based React projects. Opening the resulting
HTML later can execute its scripts and load its remote references.

Export writes one file. It never overwrites an existing file (including the source or an
output symlink), does not create parent directories, and removes its own partial output on
handled cancellation or failure. `OUTPUT_CLEANUP_FAILED` means cleanup itself failed.
An OS crash or forced kill can leave a partial file; inspect it and choose a new destination.
Workspace/config/session data is never migrated or saved by these commands.

`debug ui` writes a new evidence directory and disposable application data. See
[background UI debugging](../desktop/BACKGROUND_DEBUG.md) for its supported flow,
PowerShell commands, custom steps, isolation and executable acceptance conditions.

## Machine protocol

`--json` emits exactly one JSON object and a newline on stdout, with no progress text.
Handled errors also go to stdout in JSON mode; stderr is empty.

```json
{
  "schemaVersion": 1,
  "command": "workspace inspect",
  "ok": true,
  "data": {
    "entryCandidates": ["App.jsx"],
    "sourceFiles": ["App.jsx"],
    "styleFiles": [],
    "designDocs": [],
    "referenceDocs": [],
    "assets": [],
    "totalFiles": 1,
    "truncated": false
  }
}
```

On failure, `error` contains `category`, `code`, a safe `message` and `exitCode`.
Doctor retains its individual checks in `data` on failure. Background UI run failures
retain their report in `data`; setup failures and other operations omit it.
An invalid invocation uses command `unknown`; recognized unavailable commands use
command `unsupported`. No event stream is exposed because there are no model runs.

| Exit | Category | Examples |
| --- | --- | --- |
| 0 | success | Warnings in doctor do not fail supported offline capabilities. |
| 2 | usage | Unknown/repeated flags, missing required paths, invalid timeout/source. |
| 3 | configuration | Doctor finds missing, unreadable, malformed or invalid config. |
| 4 | runtime | Workspace/source unreadable, dependency unavailable, unexpected failure. |
| 5 | task | Empty source, export generation/write failure, output exists. |
| 6 | unsupported | `run`, `session status`, `--mcp-server`, non-HTML export formats. |
| 124 | timeout | Cooperative deadline exceeded. |
| 130 | cancelled | SIGINT / SIGTERM, including Ctrl+C where Node receives SIGINT. |

The default `--timeout-ms` is 30000 (120000 for `debug ui`); accepted range is 1–3600000.
Cancellation/deadlines are cooperative: the CLI checks between filesystem and rendering
steps, aborts output writes and waits for cleanup before reporting failure. A blocked OS
filesystem call or synchronous renderer cannot be forcibly preempted by the timer.
Use a caller-managed process deadline if a strict wall-clock ceiling is required.

## Configuration and credentials

Doctor reads `--config FILE`, otherwise `$XDG_CONFIG_HOME/open-codesign/config.toml`,
otherwise `~/.config/open-codesign/config.toml` (also on Windows). For custom desktop
storage, pass the config path shown by the app explicitly. The CLI does not guess the
Electron profile or read its `storage-settings.json`.

TOML parsing and shared `parseConfigFlexible` validation accept the desktop v1/v2/v3
formats; migration happens in memory only. Doctor reports counts of stored credentials,
whether any require Electron decryption, and whether a model selection has a credential
or supports keyless access. It never decrypts, refreshes, imports, displays or tests keys
or OAuth tokens. It does not read `auth.json` or the OS credential store.
It prints neither arbitrary config values nor parser errors, headers, URLs or stack traces.
Inventory filenames are user data and appear in inventory output.

Model execution, live session status, MCP transport, PDF/PNG/PPTX/ZIP/Markdown exports
are not implemented. Recognized unavailable operations return exit 6 with a reason.
There is no fallback that opens the desktop or takes over foreground input.
See [design and executable acceptance](DESIGN.md) for the runtime blockers and next phase.

## Verify

```sh
corepack pnpm --filter @open-codesign/cli test
corepack pnpm --filter @open-codesign/cli typecheck
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Root Turborepo checks also need the pinned `pnpm` shim on PATH, as described in
[CONTRIBUTING.md](../../CONTRIBUTING.md). `corepack pnpm` alone does not control which
pnpm executable Turborepo's children find.

Tests use temporary workspaces and synthetic credentials. They require no API account.
For the offline inspection/export paths, guarded Node subprocess tests reject Electron/browser automation imports, external
processes and network calls; the existing tsx/esbuild TypeScript compiler is the sole
permitted child process. These tests run with the real HTML exporter and vendored runtime.
