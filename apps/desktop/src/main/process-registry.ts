import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { getLogger } from './logger';

/**
 * Background process registry (T5.1).
 *
 * Per docs/v0.2-plan.md §4 "后台进程 (tab 模型)":
 *   - design tab open  -> background process alive
 *   - design tab close -> SIGTERM (3s) -> SIGKILL
 *   - app exit         -> TERM all -> KILL all
 *   - per-design ≤3 processes, global ≤10
 *
 * Each entry remembers its design (so the renderer's Processes panel
 * can scope) and its detected port (regex'd out of the first 2s of
 * stdout for vite/next/astro/webpack patterns).
 */

const log = getLogger('processes');
const PER_DESIGN_LIMIT = 3;
const GLOBAL_LIMIT = 10;

const PORT_RE =
  /(?:listening on(?:\s+port)?\s+|local:\s*http:\/\/[^:]+:|server (?:running )?on(?:\s+port)?\s+|on port\s+|http:\/\/[^:]+:|:)(\d{4,5})/i;

export interface ProcessEntry {
  id: string;
  designId: string;
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  startedAt: number;
  port?: number;
  child: ChildProcess;
}

const processes = new Map<string, ProcessEntry>();

function nextId(): string {
  return `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SpawnRequest {
  designId: string;
  command: string;
  args?: ReadonlyArray<string>;
  cwd: string;
}

export interface SpawnResult {
  ok: boolean;
  id?: string;
  reason?: string;
}

export function spawnTracked(req: SpawnRequest): SpawnResult {
  if (processes.size >= GLOBAL_LIMIT) {
    return { ok: false, reason: `global process limit (${GLOBAL_LIMIT}) reached` };
  }
  const perDesign = Array.from(processes.values()).filter(
    (p) => p.designId === req.designId,
  ).length;
  if (perDesign >= PER_DESIGN_LIMIT) {
    return { ok: false, reason: `per-design process limit (${PER_DESIGN_LIMIT}) reached` };
  }
  const child = spawn(req.command, [...(req.args ?? [])], {
    cwd: req.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Each tracked process heads its own process group so we can signal the
    // whole tree on stop. Dev servers (vite / next / astro) spawn their own
    // workers (esbuild / webpack / turbopack) which inherit the group — with
    // `detached: false` those workers would orphan when we SIGTERM the parent
    // and keep running until the user killed them by hand.
    detached: true,
  });
  const id = nextId();
  const entry: ProcessEntry = {
    id,
    designId: req.designId,
    command: req.command,
    args: req.args ?? [],
    cwd: req.cwd,
    startedAt: Date.now(),
    child,
  };
  processes.set(id, entry);

  const portTimeout = setTimeout(() => {
    // Stop scanning stdout for ports after 2s — keeps idle work down.
    child.stdout?.removeListener('data', onChunk);
  }, 2000);
  const onChunk = (buf: Buffer) => {
    const match = PORT_RE.exec(buf.toString());
    if (match?.[1]) {
      entry.port = Number(match[1]);
      clearTimeout(portTimeout);
      child.stdout?.removeListener('data', onChunk);
    }
  };
  child.stdout?.on('data', onChunk);

  child.on('exit', (code, signal) => {
    log.info('process.exit', { id, designId: req.designId, code, signal });
    processes.delete(id);
  });
  child.on('error', (err) => {
    log.warn('process.error', { id, designId: req.designId, error: String(err) });
    processes.delete(id);
  });

  return { ok: true, id };
}

export function listProcesses(designId?: string): ProcessEntry[] {
  const all = Array.from(processes.values());
  return designId ? all.filter((p) => p.designId === designId) : all;
}

export function stopProcess(id: string): boolean {
  const entry = processes.get(id);
  if (!entry) return false;
  return killChild(entry);
}

export function stopProcessesForDesign(designId: string): number {
  let n = 0;
  for (const entry of Array.from(processes.values())) {
    if (entry.designId !== designId) continue;
    if (killChild(entry)) n++;
  }
  return n;
}

export function shutdownAllProcesses(): void {
  // before-quit runs this synchronously and the event loop tears down right
  // after — `setTimeout`-based grace periods wouldn't fire. Send SIGTERM to
  // every tracked process group, then busy-wait up to 2s for them to exit,
  // then SIGKILL whatever is still around. `execSync('kill')` blocks the
  // main process briefly but that's appropriate on quit.
  const entries = Array.from(processes.values());
  for (const entry of entries) signalGroup(entry, 'SIGTERM');
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (entries.every((e) => e.child.killed || e.child.exitCode !== null)) break;
    // Spin briefly; sleep via a blocking syscall keeps CPU usage low.
    try {
      execSync('sleep 0.1');
    } catch {
      /* noop */
    }
  }
  for (const entry of entries) {
    if (entry.child.exitCode === null && !entry.child.killed) {
      signalGroup(entry, 'SIGKILL');
    }
  }
}

function signalGroup(entry: ProcessEntry, signal: NodeJS.Signals): void {
  const pid = entry.child.pid;
  if (pid === undefined) return;
  try {
    // Negative pid = target the whole process group (requires the child to
    // have been spawned with `detached: true`, which we do in `spawnTracked`).
    process.kill(-pid, signal);
  } catch (err) {
    // Group kill may fail with ESRCH if the process already exited, or with
    // EPERM on the rare case where the child changed its gid. Then signal
    // signalling just the direct child so at least the parent dies.
    try {
      entry.child.kill(signal);
    } catch {
      log.warn('process.kill.fail', { id: entry.id, signal, error: String(err) });
    }
  }
}

function killChild(entry: ProcessEntry): boolean {
  try {
    signalGroup(entry, 'SIGTERM');
    setTimeout(() => {
      if (entry.child.exitCode === null && !entry.child.killed) {
        signalGroup(entry, 'SIGKILL');
      }
    }, 3000).unref();
    return true;
  } catch (err) {
    log.warn('process.kill.fail', { id: entry.id, error: String(err) });
    return false;
  }
}

export const __test = { PORT_RE, PER_DESIGN_LIMIT, GLOBAL_LIMIT };
