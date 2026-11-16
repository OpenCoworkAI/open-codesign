import { constants } from 'node:fs';
import { access, type FileHandle, lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { inspectWorkspaceFiles } from '@open-codesign/core/workspace-inspection';
import { listWorkspaceFilesAt, readWorkspaceFileAt } from '@open-codesign/core/workspace-reader';
import { parseConfigFlexible, resolveProviderCapabilities } from '@open-codesign/shared';
import { parse as parseToml } from 'smol-toml';
import type { Arguments } from './arguments';
import { CliError, checkCancelled, type Result } from './protocol';

interface Check {
  id: string;
  status: 'ok' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface DoctorReport {
  checks: Check[];
  capabilities: {
    workspaceInspect: true;
    htmlExport: true;
    designRun: false;
    sessionStatus: false;
    mcpServer: false;
  };
}

function fileErrorCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

export function defaultConfigPath(): string {
  return path.join(
    process.env['XDG_CONFIG_HOME'] || path.join(homedir(), '.config'),
    'open-codesign',
    'config.toml',
  );
}

async function workspaceRoot(input: string): Promise<string> {
  try {
    const root = await realpath(input);
    if (!(await lstat(root)).isDirectory()) {
      throw new CliError('runtime', 'WORKSPACE_NOT_DIRECTORY', 'Workspace is not a directory.');
    }
    await access(root, constants.R_OK);
    return root;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      'runtime',
      fileErrorCode(error) === 'ENOENT' ? 'WORKSPACE_MISSING' : 'WORKSPACE_UNREADABLE',
      'Workspace is missing or cannot be read. Check --workspace and filesystem permissions.',
    );
  }
}

async function configChecks(filename: string, signal: AbortSignal): Promise<Check[]> {
  let raw: string;
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.size > 2 * 1024 * 1024)
      return [
        {
          id: 'config',
          status: 'error',
          code: 'CONFIG_INVALID_FILE',
          message: 'Config must be a regular file of at most 2 MiB.',
        },
      ];
    raw = await readFile(filename, { encoding: 'utf8', signal });
  } catch (error) {
    checkCancelled(signal);
    return [
      {
        id: 'config',
        status: 'error',
        code: fileErrorCode(error) === 'ENOENT' ? 'CONFIG_MISSING' : 'CONFIG_UNREADABLE',
        message:
          'Config is missing or unreadable. Supply --config for a custom desktop storage location.',
      },
    ];
  }
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch {
    return [
      {
        id: 'config',
        status: 'error',
        code: 'CONFIG_TOML_INVALID',
        message: 'Config is not valid TOML.',
      },
    ];
  }
  try {
    const config = parseConfigFlexible(parsed);
    const refs = Object.values(config.secrets);
    const encrypted = refs.filter((ref) => !ref.ciphertext.startsWith('plain:')).length;
    const checks: Check[] = [
      {
        id: 'config',
        status: 'ok',
        code: 'CONFIG_VALID',
        message: 'Config schema is valid; no changes were saved.',
      },
      {
        id: 'credentials',
        status: encrypted ? 'warning' : 'ok',
        code: encrypted ? 'CREDENTIALS_REQUIRE_ELECTRON' : 'CREDENTIALS_NOT_TESTED',
        message: `${refs.length} stored credential(s), ${encrypted} requiring Electron decryption. Credentials were not decrypted, refreshed or tested.`,
      },
    ];
    const provider = config.providers[config.activeProvider];
    const hasCredential = Boolean(config.secrets[config.activeProvider]?.ciphertext);
    const keyless =
      provider && resolveProviderCapabilities(config.activeProvider, provider).supportsKeyless;
    checks.push({
      id: 'model',
      status: provider && (hasCredential || keyless) ? 'ok' : 'warning',
      code: provider && (hasCredential || keyless) ? 'MODEL_CONFIGURED' : 'MODEL_NOT_READY',
      message:
        provider && (hasCredential || keyless)
          ? 'Model selection has a stored credential or permits keyless access; connectivity was not tested.'
          : 'No usable model selection or credential found. Read-only commands and HTML export remain available.',
    });
    return checks;
  } catch {
    // Schema errors can contain provider names, headers and credential values.
    return [
      {
        id: 'config',
        status: 'error',
        code: 'CONFIG_SCHEMA_INVALID',
        message: 'Config does not match a supported schema (v1, v2 or v3).',
      },
    ];
  }
}

export async function inspectWorkspace(workspace: string, signal: AbortSignal) {
  checkCancelled(signal);
  const root = await workspaceRoot(workspace);
  // A sentinel distinguishes a complete 2,000-file result from a capped scan.
  const files = await listWorkspaceFilesAt(root, { maxFiles: 2_001, signal });
  checkCancelled(signal);
  const inspection = inspectWorkspaceFiles(
    files.slice(0, 2_000).map((file) => ({ file: file.path })),
  );
  if (files.length > 2_000) inspection.truncated = true;
  return inspection;
}

export async function doctor(args: Arguments, signal: AbortSignal): Promise<Result> {
  const checks: Check[] = [
    {
      id: 'node',
      status: Number(process.versions.node.split('.')[0]) >= 22 ? 'ok' : 'error',
      code:
        Number(process.versions.node.split('.')[0]) >= 22 ? 'NODE_SUPPORTED' : 'NODE_UNSUPPORTED',
      message: 'Node.js 22 or later is required.',
    },
  ];
  checks.push(...(await configChecks(args.config ?? defaultConfigPath(), signal)));
  try {
    await inspectWorkspace(args.workspace ?? process.cwd(), signal);
    checks.push({
      id: 'workspace',
      status: 'ok',
      code: 'WORKSPACE_READABLE',
      message: 'Workspace can be scanned without modifying files.',
    });
  } catch (error) {
    checkCancelled(signal);
    checks.push({
      id: 'workspace',
      status: 'error',
      code: error instanceof CliError ? error.code : 'WORKSPACE_UNREADABLE',
      message: 'Workspace cannot be scanned. Check --workspace and filesystem permissions.',
    });
  }
  try {
    await import('@open-codesign/exporters/html');
    checks.push({
      id: 'dependencies',
      status: 'ok',
      code: 'DEPENDENCIES_AVAILABLE',
      message:
        'Workspace inspection and HTML exporter dependencies are available. No browser is required.',
    });
  } catch {
    checks.push({
      id: 'dependencies',
      status: 'error',
      code: 'DEPENDENCIES_MISSING',
      message: 'HTML exporter dependencies are unavailable. Run pnpm install --frozen-lockfile.',
    });
  }
  checkCancelled(signal);
  const data: DoctorReport = {
    checks,
    capabilities: {
      workspaceInspect: true,
      htmlExport: true,
      designRun: false,
      sessionStatus: false,
      mcpServer: false,
    },
  };
  const failure = checks.some((check) => check.status === 'error' && check.id !== 'config')
    ? new CliError('runtime', 'DOCTOR_RUNTIME_FAILED', 'One or more runtime checks failed.')
    : checks.some((check) => check.status === 'error')
      ? new CliError('configuration', 'DOCTOR_CONFIG_FAILED', 'Configuration checks failed.')
      : undefined;
  return { data, ...(failure ? { error: failure } : {}) };
}

export type HtmlBuilder = (
  source: string,
  options: {
    sourcePath: string;
    assetRootPath: string;
    assetBasePath: string;
  },
) => Promise<string>;

export async function exportHtml(
  input: {
    workspace: string;
    source: string;
    output: string;
    timeoutMs?: number;
    deadline?: number;
  },
  signal: AbortSignal,
  build?: HtmlBuilder,
) {
  const deadline = input.deadline ?? Date.now() + (input.timeoutMs ?? 30_000);
  checkCancelled(signal, deadline);
  const root = await workspaceRoot(input.workspace);
  const source = input.source.replaceAll('\\', '/');
  if (
    path.isAbsolute(source) ||
    source.includes(':') ||
    source.split('/').some((part) => part === '..' || part === '' || part === '.') ||
    !/\.(?:html?|jsx|tsx)$/i.test(source)
  ) {
    throw new CliError(
      'usage',
      'INVALID_SOURCE',
      'Source must be a workspace-relative HTML, JSX or TSX file without traversal.',
    );
  }
  if (!/\.html$/i.test(input.output))
    throw new CliError('usage', 'INVALID_OUTPUT', 'Output must have a .html extension.');
  let content: string;
  try {
    content = (await readWorkspaceFileAt(root, source)).content;
  } catch {
    checkCancelled(signal, deadline);
    throw new CliError(
      'runtime',
      'SOURCE_UNREADABLE',
      'Source is missing, hidden, unsafe, too large (2 MiB limit), or not UTF-8 text.',
    );
  }
  if (!content.trim())
    throw new CliError('task', 'EMPTY_SOURCE', 'Cannot export an empty design source.');
  const builder = build ?? (await import('@open-codesign/exporters/html')).buildInlineHtmlDocument;
  let html: string;
  try {
    html = await builder(content, {
      sourcePath: source,
      assetRootPath: root,
      assetBasePath: path.dirname(path.join(root, source)),
    });
  } catch {
    checkCancelled(signal, deadline);
    throw new CliError(
      'task',
      'EXPORT_FAILED',
      'HTML generation failed. Check the source and its assets.',
    );
  }
  checkCancelled(signal, deadline);
  const output = path.resolve(input.output);
  let handle: FileHandle;
  try {
    // Exclusive creation also rejects symlinks and protects the source itself.
    handle = await open(output, 'wx', 0o600);
  } catch (error) {
    checkCancelled(signal, deadline);
    throw new CliError(
      'task',
      fileErrorCode(error) === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_UNWRITABLE',
      'Output already exists or cannot be created. Use a new path in an existing directory.',
    );
  }
  try {
    checkCancelled(signal, deadline);
    await handle.writeFile(html, { encoding: 'utf8', signal });
    checkCancelled(signal, deadline);
    await handle.close();
    checkCancelled(signal, deadline);
  } catch (error) {
    await handle.close().catch(() => undefined);
    try {
      await unlink(output);
    } catch {
      throw new CliError(
        'task',
        'OUTPUT_CLEANUP_FAILED',
        'Export stopped but its partial output could not be removed. Inspect --output before retrying.',
      );
    }
    checkCancelled(signal);
    throw error instanceof CliError
      ? error
      : new CliError(
          'task',
          'OUTPUT_WRITE_FAILED',
          'Writing the output failed; partial output was removed.',
        );
  }
  return {
    format: 'html',
    path: output,
    bytes: Buffer.byteLength(html),
    warnings: [
      'Export was not executed or visually verified. Remote assets still require network access; unresolved local references remain unchanged.',
    ],
  };
}

export async function dispatch(
  args: Arguments,
  signal: AbortSignal,
  deadline = Date.now() + args.timeoutMs,
): Promise<Result> {
  switch (args.command) {
    case 'doctor':
      return doctor(args, signal);
    case 'workspace inspect':
      return { data: await inspectWorkspace(args.workspace ?? '', signal) };
    case 'export html':
      return {
        data: await exportHtml(
          {
            workspace: args.workspace ?? '',
            source: args.source ?? '',
            output: args.output ?? '',
            deadline,
          },
          signal,
        ),
      };
    default:
      throw new CliError(
        'unsupported',
        'UNSUPPORTED',
        'This operation is not supported by the headless CLI.',
      );
  }
}
