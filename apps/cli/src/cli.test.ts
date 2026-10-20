import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArguments } from './arguments';
import { runCli } from './cli';
import { exportHtml, inspectWorkspace } from './operations';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const entry = fileURLToPath(new URL('./main.ts', import.meta.url));
const guard = new URL('../test/headless-guard.mjs', import.meta.url).href;
const signal = () => new AbortController().signal;
let root: string;
let workspace: string;
let config: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codesign-cli-'));
  workspace = path.join(root, 'workspace with spaces');
  config = path.join(root, 'config.toml');
  await mkdir(workspace);
  await writeFile(config, 'version = 3\nactiveProvider = ""\nactiveModel = ""\n');
  await writeFile(
    path.join(workspace, 'index.html'),
    '<html><head><title>Fixture</title></head><body><h1>Design fixture</h1><img src="assets/logo.svg"></body></html>',
  );
  await mkdir(path.join(workspace, 'assets'));
  await writeFile(
    path.join(workspace, 'assets/logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Logo</text></svg>',
  );
  await writeFile(path.join(workspace, 'DESIGN.md'), '# Fixture design');
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function invoke(args: string[], dispatch?: Parameters<typeof runCli>[3]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(
    args,
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    signal(),
    dispatch,
  );
  return { code, stdout, stderr };
}

function subprocess(args: string[], guarded = true) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', ...(guarded ? ['--import', guard] : []), entry, ...args],
      { cwd: repo, timeout: 20_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
      },
    );
  });
}

async function snapshot(dir: string): Promise<unknown[]> {
  const entries: unknown[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const filename = path.join(dir, name);
    const info = await stat(filename);
    entries.push(
      info.isDirectory()
        ? [name, await snapshot(filename)]
        : [
            name,
            info.mtimeMs,
            createHash('sha256')
              .update(await readFile(filename))
              .digest('hex'),
          ],
    );
  }
  return entries;
}

describe('CLI contracts', () => {
  it('runs help without Electron, processes or network', async () => {
    const result = await subprocess(['--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    for (const text of [
      'doctor',
      'workspace inspect',
      'export html',
      '--json',
      '--timeout-ms',
      '124 timeout',
      '130 cancelled',
    ])
      expect(result.stdout).toContain(text);
    const json = await invoke(['--help', '--json']);
    expect(JSON.parse(json.stdout)).toMatchObject({ schemaVersion: 1, command: 'help', ok: true });
  });

  it('diagnoses fixtures and inspects using guarded Node subprocesses without changing any state', async () => {
    await mkdir(path.join(root, 'sessions'));
    await writeFile(path.join(root, 'sessions/session.jsonl'), '{"type":"session","version":3}\n');
    const before = await snapshot(root);
    const doc = await subprocess([
      'doctor',
      '--workspace',
      workspace,
      '--config',
      config,
      '--json',
    ]);
    expect(doc.code, doc.stderr + doc.stdout).toBe(0);
    expect(doc.stderr).toBe('');
    expect(JSON.parse(doc.stdout)).toMatchObject({
      schemaVersion: 1,
      ok: true,
      data: { capabilities: { designRun: false } },
    });
    const inspection = await subprocess([
      'workspace',
      'inspect',
      '--workspace',
      workspace,
      '--json',
    ]);
    expect(inspection.code, inspection.stdout).toBe(0);
    expect(inspection.stderr).toBe('');
    expect(JSON.parse(inspection.stdout).data).toMatchObject({
      entryCandidates: ['index.html'],
      designDocs: ['DESIGN.md'],
      totalFiles: 3,
    });
    const human = await invoke(['doctor', '--workspace', workspace, '--config', config]);
    expect(human.stdout).toContain('[ok] config (CONFIG_VALID)');
    expect(await snapshot(root)).toEqual(before);
  });

  it.each([
    ['unknown', 'value'],
    ['doctor', '--bad', 'secret'],
    ['workspace', 'inspect'],
    ['doctor', '--timeout-ms', 'NaN'],
    ['doctor', '--timeout-ms', '0'],
    ['doctor', '--workspace', 'a', '--workspace', 'b'],
    ['doctor', '--output', 'out.html'],
    ['workspace', 'inspect', '--workspace', '.', '--config', 'private'],
  ])('rejects invalid arguments without echoing input: %j', async (...args) => {
    const result = await invoke([...args, '--json']);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error.category).toBe('usage');
    expect(result.stdout).not.toContain('secret');
  });

  it('reports missing config, malformed TOML and invalid schema without leaking secrets', async () => {
    const args = ['doctor', '--workspace', workspace, '--config', config, '--json'];
    await rm(config);
    const missing = await subprocess(args);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toBe('');
    expect(JSON.parse(missing.stdout).data.checks).toContainEqual(
      expect.objectContaining({ code: 'CONFIG_MISSING' }),
    );
    for (const [body, code] of [
      ['credential = "API_KEY_SENTINEL', 'CONFIG_TOML_INVALID'],
      [
        'version = 3\nactiveProvider = "OAUTH_TOKEN_SENTINEL"\nactiveModel = "m"\n',
        'CONFIG_SCHEMA_INVALID',
      ],
    ]) {
      await writeFile(config, body ?? '');
      const result = await invoke(args);
      expect(result.code).toBe(3);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('SENTINEL');
      expect(JSON.parse(result.stdout).data.checks).toContainEqual(
        expect.objectContaining({ code }),
      );
    }
  });

  it('uses XDG config lookup without creating configuration or session state', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', root);
    await mkdir(path.join(root, 'open-codesign'));
    await writeFile(path.join(root, 'open-codesign/config.toml'), await readFile(config));
    const before = await snapshot(root);
    expect((await invoke(['doctor', '--workspace', workspace, '--json'])).code).toBe(0);
    expect(await snapshot(root)).toEqual(before);
  });

  it('reports inaccessible config and scan permissions using safe reason codes', async () => {
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(
      Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'EACCES' }),
    );
    const result = await invoke(['doctor', '--workspace', workspace, '--config', config, '--json']);
    expect(result.code).toBe(3);
    expect(result.stdout).not.toContain('PRIVATE_SENTINEL');
    expect(JSON.parse(result.stdout).data.checks).toContainEqual(
      expect.objectContaining({ code: 'CONFIG_UNREADABLE' }),
    );
    vi.restoreAllMocks();
    vi.spyOn(fs, 'readdir').mockRejectedValue(
      Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'EACCES' }),
    );
    const workspaceResult = await invoke([
      'doctor',
      '--workspace',
      workspace,
      '--config',
      config,
      '--json',
    ]);
    expect(workspaceResult.code).toBe(4);
    expect(workspaceResult.stdout).not.toContain('PRIVATE_SENTINEL');
    expect(JSON.parse(workspaceResult.stdout).data.checks).toContainEqual(
      expect.objectContaining({ code: 'WORKSPACE_UNREADABLE' }),
    );
  });

  it('reports missing/non-directory paths and returns stable runtime codes', async () => {
    for (const dir of [path.join(root, 'missing'), config]) {
      const result = await subprocess(['workspace', 'inspect', '--workspace', dir, '--json']);
      expect(result.code).toBe(4);
      expect(JSON.parse(result.stdout).error.category).toBe('runtime');
      expect(result.stderr).toBe('');
    }
    const doc = await invoke([
      'doctor',
      '--workspace',
      path.join(root, 'missing'),
      '--config',
      config,
      '--json',
    ]);
    expect(doc.code).toBe(4);
    expect(JSON.parse(doc.stdout).data.checks).toContainEqual(
      expect.objectContaining({ code: 'WORKSPACE_MISSING' }),
    );
  });

  it('never serializes credentials or raw unexpected errors', async () => {
    await writeFile(
      config,
      `version = 3\nactiveProvider = ""\nactiveModel = ""\n[secrets.a]\nciphertext = "plain:API_KEY_SENTINEL"\n[secrets.b]\nciphertext = "safe:OAUTH_TOKEN_SENTINEL"\n`,
    );
    const result = await invoke(['doctor', '--config', config, '--workspace', workspace, '--json']);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('SENTINEL');
    expect(JSON.parse(result.stdout).data.checks).toContainEqual(
      expect.objectContaining({ code: 'CREDENTIALS_REQUIRE_ELECTRON' }),
    );
    const failure = await invoke(['doctor', '--json'], async () => {
      throw new Error('Bearer OAUTH_TOKEN_SENTINEL');
    });
    expect(failure.code).toBe(4);
    expect(failure.stdout + failure.stderr).not.toContain('SENTINEL');
  });

  it.each([
    ['run'],
    ['session', 'status'],
    ['--mcp-server'],
    ['export', 'pdf'],
  ])('explicitly refuses unsupported operations: %j', async (...args) => {
    const result = await subprocess([...args, '--json']);
    expect(result.code).toBe(6);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error.code).toBe('UNSUPPORTED');
  });
});

describe('real export', () => {
  it.each(['failure', 'cancel'])('removes its partial output on write %s', async (mode) => {
    const output = path.join(root, 'partial.html');
    const controller = new AbortController();
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await realOpen(...args);
      const realWrite = handle.writeFile.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await realWrite('partial');
        if (mode === 'cancel') controller.abort();
        throw new Error('PRIVATE_WRITE_SENTINEL');
      });
      return handle;
    });
    await expect(
      exportHtml(
        { workspace, source: 'index.html', output },
        controller.signal,
        async () => '<html>fixture</html>',
      ),
    ).rejects.toMatchObject({ code: mode === 'cancel' ? 'CANCELLED' : 'OUTPUT_WRITE_FAILED' });
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exports HTML and JSX using the shared exporter under the headless guard', async () => {
    for (const source of ['index.html', 'App.jsx']) {
      if (source.endsWith('.jsx'))
        await writeFile(
          path.join(workspace, source),
          'function App() { return <h1>JSX fixture</h1>; }',
        );
      const output = path.join(root, `${source}.html`);
      const result = await subprocess([
        'export',
        'html',
        '--workspace',
        workspace,
        '--source',
        source,
        '--output',
        output,
        '--json',
      ]);
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stderr).toBe('');
      const content = await readFile(output, 'utf8');
      expect(content.toLowerCase()).toContain('<!doctype html>');
      expect(content).toContain(source === 'index.html' ? 'Design fixture' : 'JSX fixture');
      if (source === 'index.html') expect(content).toContain('data:image/svg+xml');
      expect(JSON.parse(result.stdout).data.bytes).toBe(Buffer.byteLength(content));
    }
  });

  it('rejects overwrite, missing parent and empty source with task failure exit 5', async () => {
    const output = path.join(root, 'out.html');
    await writeFile(output, 'preserve me');
    const args = [
      'export',
      'html',
      '--workspace',
      workspace,
      '--source',
      'index.html',
      '--output',
      output,
      '--json',
    ];
    expect((await subprocess(args)).code).toBe(5);
    expect(await readFile(output, 'utf8')).toBe('preserve me');
    const missing = await invoke([
      'export',
      'html',
      '--workspace',
      workspace,
      '--source',
      'index.html',
      '--output',
      path.join(root, 'missing/out.html'),
      '--json',
    ]);
    expect(JSON.parse(missing.stdout).error.code).toBe('OUTPUT_UNWRITABLE');
    await writeFile(path.join(workspace, 'index.html'), '');
    const empty = await subprocess(args);
    expect(empty.code).toBe(5);
    expect(JSON.parse(empty.stdout).error.code).toBe('EMPTY_SOURCE');
  });

  it('blocks traversal, hidden source and symlink escape without reading external contents', async () => {
    await mkdir(path.join(root, 'external'));
    await writeFile(path.join(root, 'external/secret.html'), '<h1>EXTERNAL_SECRET</h1>');
    await symlink(
      path.join(root, 'external'),
      path.join(workspace, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    for (const source of ['../external/secret.html', 'linked/secret.html', '.hidden.html']) {
      await expect(
        exportHtml({ workspace, source, output: path.join(root, 'out.html') }, signal()),
      ).rejects.toThrow();
    }
    await writeFile(path.join(workspace, 'index.html'), '<img src="linked/secret.html">');
    await exportHtml(
      { workspace, source: 'index.html', output: path.join(root, 'out.html') },
      signal(),
    );
    expect(await readFile(path.join(root, 'out.html'), 'utf8')).not.toContain('EXTERNAL_SECRET');
  });

  it('does not write output after cancellation or timeout during rendering', async () => {
    const controller = new AbortController();
    const output = path.join(root, 'cancel.html');
    await expect(
      exportHtml({ workspace, source: 'index.html', output }, controller.signal, async () => {
        controller.abort();
        return '<html>late</html>';
      }),
    ).rejects.toMatchObject({ category: 'cancelled' });
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const now = Date.now();
    await expect(
      exportHtml({ workspace, source: 'index.html', output, timeoutMs: 10 }, signal(), async () => {
        vi.spyOn(Date, 'now').mockReturnValue(now + 1_000);
        return '<html>late</html>';
      }),
    ).rejects.toMatchObject({ category: 'timeout' });
    vi.restoreAllMocks();
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('cancellation and bounds', () => {
  it('cancels a shared workspace scan between filesystem operations', async () => {
    const controller = new AbortController();
    const readdir = fs.readdir;
    vi.spyOn(fs, 'readdir').mockImplementationOnce(async (...args) => {
      const entries = await readdir(...args);
      controller.abort(new Error('scan cancelled'));
      return entries;
    });
    await expect(inspectWorkspace(workspace, controller.signal)).rejects.toThrow('scan cancelled');
  });

  it('returns 124 for a controlled timeout, and 130 for cancellation', async () => {
    vi.useFakeTimers();
    const pending = invoke(
      ['doctor', '--timeout-ms', '10', '--json'],
      async (_args, abortSignal) => {
        await new Promise<void>((resolve) =>
          abortSignal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return { data: {} };
      },
    );
    await vi.advanceTimersByTimeAsync(11);
    const timed = await pending;
    expect(timed.code).toBe(124);
    expect(JSON.parse(timed.stdout).error.code).toBe('TIMEOUT');
    const controller = new AbortController();
    controller.abort();
    const dispatch = vi.fn();
    let stdout = '';
    const code = await runCli(
      ['doctor', '--json'],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: vi.fn(),
      },
      controller.signal,
      dispatch,
    );
    expect(code).toBe(130);
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.parse(stdout).error.code).toBe('CANCELLED');
  });

  it('excludes hidden/internal files and flags truncated groups', async () => {
    await mkdir(path.join(workspace, '.codesign'));
    await writeFile(path.join(workspace, '.codesign/settings.json'), 'secret');
    await writeFile(path.join(workspace, '.env'), 'secret');
    for (let i = 0; i < 25; i++) await writeFile(path.join(workspace, `source${i}.js`), '');
    const result = await inspectWorkspace(workspace, signal());
    expect(result.totalFiles).toBe(28);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('parses quoted Windows paths without rewriting them', () => {
    expect(
      parseArguments(['workspace', 'inspect', '--workspace', 'C:\\Design Work\\Example']).workspace,
    ).toBe('C:\\Design Work\\Example');
  });
});
