import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { hashJson } from './corpus.js';
import { type ValidatedHostJob, validateHostJob } from './state-host-policy.js';
import { parseUnifiedConfig, type UnifiedConfig } from './unified-config.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
interface RunnerRequest {
  id: string;
  track: string;
  configPath: string;
  preflightPath: string;
  outputPath: string;
  logDirectory: string;
  signal: AbortSignal;
  onStart: (pid: number) => void;
}
type Runner = (
  request: RunnerRequest,
) => Promise<{ exitCode: number | null; signal: string | null }>;
const sources = () =>
  Object.fromEntries(
    ['state-experiment-host.ts', 'state-host-policy.ts'].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest('hex'),
    ]),
  );
function inside(root: string, path: string) {
  const part = relative(root, path);
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
}
function redact(text: string, secrets: string[]) {
  for (const secret of secrets)
    for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])
      if (form) text = text.replaceAll(form, '[REDACTED]');
  return text;
}
function fixedRunner(seed: UnifiedConfig): Runner {
  const secrets = [
    ...new Set(
      Object.values(seed.models)
        .map((target) => process.env[target.credentialEnv]?.trim())
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  return (request) =>
    new Promise((resolveResult) => {
      const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
      const child = spawn(
        process.execPath,
        [
          '--import',
          tsx,
          join(repository, 'research/goal-aware-context/state-stress-cli.ts'),
          '--track',
          request.track,
          '--config',
          request.configPath,
          '--preflight',
          request.preflightPath,
          '--output',
          request.outputPath,
          '--execute',
        ],
        {
          cwd: repository,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: join(repository, 'research/goal-aware-context/tsconfig.json'),
          },
        },
      );
      const output: Buffer[] = [],
        errors: Buffer[] = [];
      let bytes = 0,
        overflow = false,
        settled = false;
      const collect = (parts: Buffer[], chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1048576) {
          overflow = true;
          child.kill('SIGTERM');
        } else parts.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(output, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(errors, chunk));
      const abort = () => {
        child.kill('SIGTERM');
      };
      request.signal.addEventListener('abort', abort, { once: true });
      const finish = (exitCode: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        request.signal.removeEventListener('abort', abort);
        const safe = (parts: Buffer[]) =>
          overflow || request.signal.aborted
            ? '[output not retained: interrupted or limited]\n'
            : redact(Buffer.concat(parts).toString('utf8'), secrets);
        try {
          writeFileSync(join(request.logDirectory, `${request.id}.stdout.log`), safe(output), {
            flag: 'wx',
          });
          writeFileSync(join(request.logDirectory, `${request.id}.stderr.log`), safe(errors), {
            flag: 'wx',
          });
        } catch {
          exitCode = 1;
        }
        resolveResult({ exitCode, signal });
      };
      child.once('error', () => finish(1, 'spawn-error'));
      child.once('close', (code, signal) => finish(code, signal));
      if (child.pid) {
        try {
          request.onStart(child.pid);
        } catch {
          abort();
        }
      }
      if (request.signal.aborted) abort();
    });
}
export function createStateExperimentHost(options: {
  root: string;
  directory: string;
  config: UnifiedConfig;
  maxCalls: number;
  runner?: Runner;
}) {
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 300)
    throw Error('host-cap-must-be-1-to-300');
  const root = realpathSync(resolve(options.root)),
    directory = resolve(options.directory);
  if (!inside(root, directory) || realpathSync(dirname(directory)) !== root)
    throw Error('host-directory-must-be-new-direct-child-of-root');
  const seed = parseUnifiedConfig(options.config),
    sourceHashes = sources();
  mkdirSync(directory);
  for (const folder of ['requests', 'results', 'jobs', 'logs']) mkdirSync(join(directory, folder));
  const state = {
    protocol: 'state-experiment-host@1',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ready',
    root,
    directory,
    maxCalls: options.maxCalls,
    reservedCalls: 0,
    remainingCalls: options.maxCalls,
    activeJob: null as string | null,
    childPid: null as number | null,
    sourceHashes,
    models: seed.models,
    credentialReady: Object.fromEntries(
      Object.entries(seed.models).map(([role, target]) => [
        role,
        target.allowKeyless || Boolean(process.env[target.credentialEnv]?.trim()),
      ]),
    ),
  };
  const processed = new Set<string>(),
    seenPlans = new Set<string>();
  let stopped = false,
    busy = false,
    controller: AbortController | null = null;
  const runner = options.runner ?? fixedRunner(seed);
  const persist = () => {
    state.updatedAt = new Date().toISOString();
    try {
      writeFileSync(join(directory, 'host.json'), `${JSON.stringify(state, null, 2)}\n`);
    } catch {
      stopped = true;
      state.status = 'stopped';
      controller?.abort();
      throw Error('host-state-persistence-failed');
    }
  };
  const result = (id: string, value: unknown) =>
    writeFileSync(join(directory, 'results', `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
  const stop = () => {
    stopped = true;
    state.status = 'stopped';
    controller?.abort();
    persist();
  };
  persist();
  return {
    snapshot: () => structuredClone(state),
    heartbeat: persist,
    stop,
    async processNext(): Promise<boolean> {
      if (stopped || busy) return false;
      const name = readdirSync(join(directory, 'requests'))
        .sort()
        .find(
          (file) =>
            file.endsWith('.json') && safeId.test(file.slice(0, -5)) && !processed.has(file),
        );
      if (!name) return false;
      processed.add(name);
      const id = name.slice(0, -5);
      let job: ValidatedHostJob;
      try {
        if (hashJson(sources()) !== hashJson(sourceHashes)) throw Error('host-source-changed');
        const path = join(directory, 'requests', name);
        if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
          throw Error('invalid-request-file');
        job = validateHostJob(JSON.parse(readFileSync(path, 'utf8')), {
          root,
          seedConfig: seed,
          remainingCalls: state.remainingCalls,
          seenPlans,
        });
        if (job.id !== id) throw Error('request-filename-id-mismatch');
      } catch {
        result(id, {
          id,
          status: 'rejected',
          reason: 'policy-rejected; inspect paths, config, preflight, replay and remaining cap',
          actualProviderCalls: 0,
        });
        return true;
      }
      busy = true;
      controller = new AbortController();
      let childPid: number | null = null;
      try {
        const staged = join(directory, 'jobs', id);
        mkdirSync(staged);
        const configPath = join(staged, 'config.json'),
          preflightPath = join(staged, 'plan.json');
        writeFileSync(configPath, `${JSON.stringify(job.config, null, 2)}\n`, { flag: 'wx' });
        writeFileSync(preflightPath, `${JSON.stringify(job.preflight, null, 2)}\n`, { flag: 'wx' });
        appendFileSync(
          join(directory, 'ledger.jsonl'),
          `${JSON.stringify({
            event: 'reserved',
            id,
            planHash: job.planHash,
            calls: job.reserveCalls,
            at: new Date().toISOString(),
          })}\n`,
        );
        state.reservedCalls += job.reserveCalls;
        state.remainingCalls -= job.reserveCalls;
        seenPlans.add(job.planHash);
        state.activeJob = id;
        state.status = 'running';
        result(id, {
          id,
          status: 'running',
          planHash: job.planHash,
          reserveCalls: job.reserveCalls,
          actualProviderCalls: null,
          output: job.outputPath,
        });
        persist();
        const run = await runner({
          id,
          track: job.track,
          configPath,
          preflightPath,
          outputPath: job.outputPath,
          logDirectory: join(directory, 'logs'),
          signal: controller.signal,
          onStart: (pid) => {
            childPid = pid;
            state.childPid = pid;
            persist();
          },
        });
        let actual: number | null = null,
          reportStatus: string | null = null,
          validReport = false;
        try {
          const report = z
            .object({
              planHash: z.literal(job.planHash),
              actualProviderCalls: z.number().int().min(0).max(job.reserveCalls),
              status: z.string(),
              executorPid: z.number().int().positive(),
            })
            .parse(JSON.parse(readFileSync(join(job.outputPath, 'report.json'), 'utf8')));
          if (report.executorPid !== childPid) throw Error('child-process-identity-mismatch');
          actual = report.actualProviderCalls;
          reportStatus = report.status;
          validReport = report.status === 'complete' || report.status === 'incomplete';
        } catch {
          /* Interrupted/fatal jobs can have no authoritative final count. */
        }
        const status = controller.signal.aborted
          ? 'interrupted'
          : !validReport
            ? 'failed'
            : run.exitCode === 0 && reportStatus === 'complete'
              ? 'completed'
              : reportStatus === 'incomplete'
                ? 'incomplete'
                : 'failed';
        result(id, {
          id,
          status,
          planHash: job.planHash,
          reserveCalls: job.reserveCalls,
          actualProviderCalls: actual,
          exitCode: run.exitCode,
          signal: run.signal,
          childPid,
          output: job.outputPath,
          finishedAt: new Date().toISOString(),
        });
      } catch {
        result(id, {
          id,
          status: stopped ? 'interrupted' : 'failed',
          planHash: job.planHash,
          reserveCalls: job.reserveCalls,
          actualProviderCalls: null,
          childPid,
          output: job.outputPath,
          reason: 'execution-or-persistence-error; no automatic retry',
        });
      } finally {
        busy = false;
        controller = null;
        state.activeJob = null;
        state.childPid = null;
        state.status = stopped
          ? 'stopped'
          : state.remainingCalls === 0
            ? 'budget-exhausted'
            : 'ready';
        persist();
      }
      return true;
    },
  };
}
async function main(args: string[]) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('node22-required');
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i],
      value = args[++i];
    if (
      !flag ||
      !['--workspace', '--config', '--max-calls'].includes(flag) ||
      !value ||
      value.startsWith('--') ||
      values.has(flag)
    )
      throw Error('invalid-arguments');
    values.set(flag, value);
  }
  const workspace = values.get('--workspace'),
    config = values.get('--config');
  if (!workspace || !config) throw Error('workspace-and-config-required');
  const directory = resolve(workspace),
    root = realpathSync(dirname(directory)),
    allowed = realpathSync(join(repository, '.Codex/workspace/goal-aware-context'));
  if (!inside(allowed, root)) throw Error('workspace-outside-research-root');
  const host = createStateExperimentHost({
    root,
    directory,
    config: parseUnifiedConfig(JSON.parse(readFileSync(resolve(config), 'utf8'))),
    maxCalls: Number(values.get('--max-calls') ?? 300),
  });
  const stop = () => {
    try {
      host.stop();
    } catch {
      /* Stop aborts the child before persisting. */
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let idleSince = Date.now();
  const deadline = Date.now() + 4 * 60 * 60 * 1000;
  const monitor = setInterval(() => {
    try {
      if (existsSync(join(directory, 'STOP')) || Date.now() > deadline) host.stop();
      else host.heartbeat();
    } catch {
      /* Persistence failure has already stopped the host and aborted its child. */
    }
  }, 1000);
  process.stdout.write(
    `${JSON.stringify({
      host: directory,
      status: 'ready',
      pid: process.pid,
      maxCalls: host.snapshot().maxCalls,
      modelConfigLocked: true,
    })}\n`,
  );
  try {
    while (host.snapshot().status !== 'stopped' && host.snapshot().status !== 'budget-exhausted') {
      if (await host.processNext()) {
        idleSince = Date.now();
        process.stdout.write(
          `${JSON.stringify({
            status: host.snapshot().status,
            reservedCalls: host.snapshot().reservedCalls,
            remainingCalls: host.snapshot().remainingCalls,
          })}\n`,
        );
      } else {
        if (Date.now() - idleSince > 3600000) host.stop();
        else await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
      }
    }
  } finally {
    clearInterval(monitor);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    host.stop();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      'State experiment host failed; inspect arguments/local evidence. No credential values are logged.\n',
    );
    process.exitCode = 1;
  });
