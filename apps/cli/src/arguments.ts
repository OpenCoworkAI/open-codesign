import { parseArgs } from 'node:util';
import { CliError } from './protocol';

export const HELP = `Open CoDesign CLI (Node.js 22+, no GUI)

Usage:
  node --import tsx apps/cli/src/main.ts --help
  node --import tsx apps/cli/src/main.ts doctor [--workspace PATH] [--config FILE] [--json]
  node --import tsx apps/cli/src/main.ts workspace inspect --workspace PATH [--json]
  node --import tsx apps/cli/src/main.ts export html --workspace PATH --source FILE --output FILE [--json]
  node --import tsx apps/cli/src/main.ts debug ui --output NEW_DIR [--steps FILE] [--json]
  node --import tsx apps/cli/src/main.ts debug session --output NEW_DIR [--idle-timeout-ms N]

Options:
  --help, -h          Show this help (also supports --json)
  --json             One versioned JSON result (debug session always uses JSONL)
  --workspace PATH   Workspace directory; doctor defaults to current directory
  --config FILE      doctor only: config.toml (default: XDG_CONFIG_HOME/open-codesign/
                     config.toml or ~/.config/open-codesign/config.toml)
  --source FILE      Workspace-relative .html, .htm, .jsx or .tsx source
  --output PATH      New .html file, or new debug report directory; parent must exist
  --steps FILE       debug ui only: {schemaVersion:1,steps:[...]} (1-16 preview steps)
  --timeout-ms N     Timeout (default 30000; debug ui 120000; session 1800000; max 3600000)
  --idle-timeout-ms N  debug session only: input idle timeout (default 300000; max 3600000)

Read-only: doctor, workspace inspect. Export writes only the explicit output.
debug ui uses offscreen Electron, temporary data, screenshot/report output; build first:
  pnpm --filter @open-codesign/desktop build --mode background-debug
It uses real desktop IPC with a restricted development allowlist; native dialogs,
model calls, credentials and external opening are unsupported. No physical input.
debug session keeps one isolated instance; JSONL stdin methods: snapshot, act, close.
Each request: {schemaVersion:1,id:"unique-id",method:"snapshot"}.
act adds steps:[...]; ready/response/closed JSONL messages go to stdout. EOF closes.
SIGINT/SIGTERM cancel. No model calls, credential refresh or GUI fallback.
Unsupported: run, session status, --mcp-server and non-HTML exports.
pnpm --silent cli is a convenience alias; pnpm run can normalize failure exits to 1.
Use the direct Node entry above when consuming exit codes.

Exit codes:
  0 success; 2 usage; 3 configuration; 4 runtime/path; 5 task/export;
  6 unsupported; 124 timeout; 130 cancelled.
`;

export type Command =
  | 'help'
  | 'doctor'
  | 'workspace inspect'
  | 'export html'
  | 'debug ui'
  | 'debug session'
  | 'unsupported';

export interface Arguments {
  command: Command;
  json: boolean;
  timeoutMs: number;
  workspace?: string;
  config?: string;
  source?: string;
  output?: string;
  steps?: string;
  idleTimeoutMs?: number;
}

function usage(message: string): never {
  throw new CliError('usage', 'INVALID_ARGUMENTS', message);
}

export function parseArguments(argv: string[]): Arguments {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        workspace: { type: 'string' },
        config: { type: 'string' },
        source: { type: 'string' },
        output: { type: 'string' },
        steps: { type: 'string' },
        'timeout-ms': { type: 'string' },
        'idle-timeout-ms': { type: 'string' },
        'mcp-server': { type: 'boolean' },
      },
    });
  } catch {
    usage('Invalid arguments. Use --help for supported commands and options.');
  }
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) usage('Options must not be repeated.');
    seen.add(token.name);
  }
  const { values, positionals } = parsed;
  const name = positionals.join(' ');
  let command: Command;
  if (values['help'] || name === 'help' || argv.length === 0) command = 'help';
  else if (values['mcp-server']) command = 'unsupported';
  else if (
    name === 'doctor' ||
    name === 'workspace inspect' ||
    name === 'export html' ||
    name === 'debug ui' ||
    name === 'debug session'
  )
    command = name;
  else if (
    values['mcp-server'] ||
    positionals[0] === 'run' ||
    name === 'session status' ||
    positionals[0] === 'export'
  )
    command = 'unsupported';
  else usage('Unknown command. Use --help for supported commands.');

  const timeout = values['timeout-ms'];
  const timeoutMs =
    timeout === undefined
      ? command === 'debug ui'
        ? 120_000
        : command === 'debug session'
          ? 1_800_000
          : 30_000
      : Number(timeout);
  if (
    (typeof timeout === 'string' && !/^\d+$/.test(timeout)) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 3_600_000
  )
    usage('--timeout-ms must be an integer from 1 to 3600000.');

  const out: Arguments = { command, json: values['json'] === true, timeoutMs };
  const idle = values['idle-timeout-ms'];
  if (idle !== undefined && command !== 'debug session')
    usage('--idle-timeout-ms is only supported by debug session.');
  if (command === 'debug session') {
    const idleTimeoutMs = idle === undefined ? 300_000 : Number(idle);
    if (
      (typeof idle === 'string' && !/^\d+$/.test(idle)) ||
      !Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs < 1 ||
      idleTimeoutMs > 3_600_000
    )
      usage('--idle-timeout-ms must be an integer from 1 to 3600000.');
    out.idleTimeoutMs = idleTimeoutMs;
    out.json = true;
  }
  for (const key of ['workspace', 'config', 'source', 'output', 'steps'] as const) {
    const value = values[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0)
      usage('Path options must have non-empty values.');
    out[key] = value;
  }
  if (command === 'help' || command === 'unsupported') return out;
  if (command !== 'doctor' && out.config) usage('--config is only supported by doctor.');
  if (command !== 'debug ui' && out.steps) usage('--steps is only supported by debug ui.');
  if (command === 'debug ui' || command === 'debug session') {
    if (!out.output || out.workspace || out.source || (command === 'debug session' && out.steps))
      usage(
        'debug ui/session requires --output NEW_DIR; --workspace and --source are not supported. Session steps arrive on stdin.',
      );
    return out;
  }
  if (command !== 'export html' && (out.source || out.output))
    usage('--source and --output are only supported by export html.');
  if (command !== 'doctor' && !out.workspace) usage('--workspace is required.');
  if (command === 'export html' && (!out.source || !out.output))
    usage('export html requires --source and --output.');
  return out;
}
