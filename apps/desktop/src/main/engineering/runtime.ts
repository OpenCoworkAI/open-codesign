import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import type {
  EngineeringError,
  EngineeringErrorKind,
  EngineeringLogLine,
  EngineeringPackageManager,
  EngineeringRunState,
  EngineeringStatus,
  LaunchEntry,
} from '@open-codesign/shared';
import { getLogger } from '../logger';
import { runInstall, shouldInstall } from './installer';
import { LogRingBuffer } from './log-buffer';
import { extractReadyUrl } from './ready-url';
import { readEngineeringSettings, writeEngineeringSettings } from './settings';

const logger = getLogger('engineering-runtime');

const LOG_RING_CAPACITY = 500;
const ERROR_EXCERPT_LINES = 30;
const READY_URL_TIMEOUT_MS = 60_000;
/** When the user supplied a manual ready URL we still wait briefly so the
 *  dev server has a chance to bind its port — just much shorter than the
 *  hard timeout. After this elapses we trust the manual URL even if no
 *  matching line ever shows up on stdout. */
const MANUAL_READY_URL_GRACE_MS = 3_000;
const STOP_SIGTERM_GRACE_MS = 4_000;

/** Probe a TCP host:port to see if something is already listening. Used by
 *  start() to short-circuit the spawn when the user's dev server is still
 *  alive from a previous app session (or running independently in a
 *  terminal). 250ms is generous for localhost \u2014 anything slower is treated
 *  as "not listening" and we fall through to spawning. */
function isPortListening(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const done = (alive: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Parse an http(s) URL into a probe target. Returns null when the URL is
 *  malformed or the port is missing and the protocol's default would be
 *  outside what dev servers normally use (we only probe for explicit ports
 *  to avoid false positives against the OS-wide :80 / :443 listeners). */
function urlToProbeTarget(url: string | null): { host: string; port: number; url: string } | null {
  if (url === null || url === '') return null;
  try {
    const u = new URL(url);
    const host = u.hostname === '' ? 'localhost' : u.hostname;
    const port = u.port === '' ? null : Number(u.port);
    if (port === null || !Number.isFinite(port)) return null;
    return { host, port, url };
  } catch {
    return null;
  }
}

export interface StartArgs {
  designId: string;
  workspacePath: string;
  packageManager: EngineeringPackageManager;
  launchEntry: LaunchEntry;
  /** Optional override propagated from EngineeringConfig.manualReadyUrl. */
  manualReadyUrl?: string | null;
}

interface RunSlot {
  designId: string;
  workspacePath: string;
  packageManager: EngineeringPackageManager;
  launchEntry: LaunchEntry;
  /** Mirrors EngineeringConfig.manualReadyUrl so we can preserve it across
   *  restarts when persisting settings on markReady. */
  manualReadyUrl: string | null;
  child: ChildProcess | null;
  state: EngineeringRunState;
  logs: LogRingBuffer;
  readyUrlTimer: NodeJS.Timeout | null;
  /** Resolves when ready URL is found OR launch fails. Used by start() to
   *  return a stable post-startup state to the caller. */
  readyDeferred: {
    resolve: (state: EngineeringRunState) => void;
    reject: (err: Error) => void;
  } | null;
  /** Set when stop() is called so the exit handler knows the termination was
   *  requested rather than a crash. */
  stopRequested: boolean;
}

interface RuntimeEvents {
  'run-state': (state: EngineeringRunState) => void;
  log: (entry: { designId: string; line: EngineeringLogLine }) => void;
}

export class EngineeringRuntime extends EventEmitter {
  private readonly slots = new Map<string, RunSlot>();

  override on<K extends keyof RuntimeEvents>(event: K, listener: RuntimeEvents[K]): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof RuntimeEvents>(
    event: K,
    ...args: Parameters<RuntimeEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /** Returns the latest run state for `designId`, or null when no run has
   *  been initiated. Idempotent and side-effect-free. */
  getRunState(designId: string): EngineeringRunState | null {
    return this.slots.get(designId)?.state ?? null;
  }

  /** Snapshot of all currently tracked slots (used by quit hooks). */
  listActive(): RunSlot[] {
    return Array.from(this.slots.values()).filter((s) => s.child !== null);
  }

  /** Run `<pm> install` if the workspace looks stale (missing node_modules
   *  or lockfile newer than node_modules). The IPC layer should call this
   *  *after* showing the user the install permission prompt — the runtime
   *  itself does not gate on user consent. */
  async initializeDependencies(args: {
    designId: string;
    workspacePath: string;
    packageManager: EngineeringPackageManager;
    launchEntry: LaunchEntry;
  }): Promise<EngineeringRunState> {
    const decision = shouldInstall(args.workspacePath, args.packageManager);
    const logs = this.slots.get(args.designId)?.logs ?? new LogRingBuffer(LOG_RING_CAPACITY);
    const slot: RunSlot = this.slots.get(args.designId) ?? {
      designId: args.designId,
      workspacePath: args.workspacePath,
      packageManager: args.packageManager,
      launchEntry: args.launchEntry,
      manualReadyUrl: null,
      child: null,
      state: this.makeState(args.designId, 'detecting', null, null, logs),
      logs,
      readyUrlTimer: null,
      readyDeferred: null,
      stopRequested: false,
    };
    // Refresh the slot context — ack flow may have changed packageManager/entry.
    slot.workspacePath = args.workspacePath;
    slot.packageManager = args.packageManager;
    slot.launchEntry = args.launchEntry;
    this.slots.set(args.designId, slot);

    if (!decision.needed) {
      // Skip install and surface a "ready to start" intermediate state.
      slot.state = this.makeState(args.designId, 'awaiting-ack', null, null, logs);
      this.emit('run-state', slot.state);
      return slot.state;
    }

    slot.state = this.makeState(args.designId, 'initializing-deps', null, null, logs);
    this.emit('run-state', slot.state);

    try {
      const result = await runInstall(
        args.workspacePath,
        args.packageManager,
        ({ stream, text }) => {
          const line = logs.push(stream, text);
          this.emit('log', { designId: args.designId, line });
        },
      );
      if (result.exitCode !== 0) {
        const error: EngineeringError = {
          schemaVersion: 1,
          kind: 'init',
          message: `${args.packageManager} install exited with code ${result.exitCode}`,
          excerpt: result.excerpt,
          command: `${args.packageManager} install`,
        };
        slot.state = this.makeState(args.designId, 'error', null, error, logs);
        this.emit('run-state', slot.state);
        return slot.state;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error: EngineeringError = {
        schemaVersion: 1,
        kind: 'init',
        message,
        excerpt: logs.tail(ERROR_EXCERPT_LINES),
        command: `${args.packageManager} install`,
      };
      slot.state = this.makeState(args.designId, 'error', null, error, logs);
      this.emit('run-state', slot.state);
      return slot.state;
    }

    slot.state = this.makeState(args.designId, 'awaiting-ack', null, null, logs);
    this.emit('run-state', slot.state);
    return slot.state;
  }

  /** Spawn the dev server. Returns once a ready URL is detected, the launch
   *  fails, or READY_URL_TIMEOUT_MS elapses. The returned state always
   *  reflects the post-startup terminal state for this start attempt. */
  start(args: StartArgs): Promise<EngineeringRunState> {
    return new Promise<EngineeringRunState>((resolve, reject) => {
      const existing = this.slots.get(args.designId);
      // Build candidate URLs to probe. We always check the port FIRST,
      // before any designId-keyed slot logic, because the user's mental
      // model is "if something is already serving on that port, just
      // attach to it". The slot map is an implementation detail; the
      // port is the source of truth for whether a dev server is up.
      const probeTargets: Array<{ host: string; port: number; url: string }> = [];
      const manualTarget = urlToProbeTarget(args.manualReadyUrl ?? null);
      if (manualTarget !== null) probeTargets.push(manualTarget);
      // The slot's last known ready URL (in-memory) and the persisted
      // lastReadyUrl (on disk) are both worth probing — covers
      // "I already started this session" and "the dev server survived
      // an app restart".
      const inMemoryTarget = urlToProbeTarget(existing?.state.readyUrl ?? null);
      if (
        inMemoryTarget !== null &&
        !probeTargets.some((t) => t.host === inMemoryTarget.host && t.port === inMemoryTarget.port)
      ) {
        probeTargets.push(inMemoryTarget);
      }
      try {
        const saved = readEngineeringSettings(args.workspacePath);
        const savedTarget = urlToProbeTarget(saved?.lastReadyUrl ?? null);
        if (
          savedTarget !== null &&
          !probeTargets.some((t) => t.host === savedTarget.host && t.port === savedTarget.port)
        ) {
          probeTargets.push(savedTarget);
        }
      } catch {
        // best-effort; settings.json may not exist yet
      }

      void (async () => {
        // 1) Port-first: if any candidate port is already serving, attach.
        for (const target of probeTargets) {
          const alive = await isPortListening(target.host, target.port);
          if (alive) {
            const logs = existing?.logs ?? new LogRingBuffer(LOG_RING_CAPACITY);
            logs.reset();
            const slot: RunSlot = {
              designId: args.designId,
              workspacePath: args.workspacePath,
              packageManager: args.packageManager,
              launchEntry: args.launchEntry,
              manualReadyUrl: args.manualReadyUrl ?? null,
              child: null,
              state: this.makeState(args.designId, 'starting', null, null, logs),
              logs,
              readyUrlTimer: null,
              readyDeferred: { resolve, reject },
              stopRequested: false,
            };
            this.slots.set(args.designId, slot);
            this.transition(slot, 'starting');
            this.recordLog(
              slot,
              'stdout',
              `[codesign] reusing existing dev server at ${target.url}`,
            );
            this.markReady(slot, target.url);
            return;
          }
        }
        // 2) No port answered: spawn fresh. We don't gate on the in-memory
        //    slot here — the dev server (with its HMR loop) is the
        //    authoritative state. If a slot exists but its port is dead,
        //    the previous child has died and we should restart anyway.
        this.spawnChildImpl(args, existing, { resolve, reject });
      })();
    });
  }

  /** Inner spawn helper extracted from start() so the port-probe path can
   *  defer to it after async probing. */
  private spawnChildImpl(
    args: StartArgs,
    existing: RunSlot | undefined,
    deferred: {
      resolve: (state: EngineeringRunState) => void;
      reject: (err: Error) => void;
    },
  ): void {
    const logs = existing?.logs ?? new LogRingBuffer(LOG_RING_CAPACITY);
    logs.reset();

    const slot: RunSlot = {
      designId: args.designId,
      workspacePath: args.workspacePath,
      packageManager: args.packageManager,
      launchEntry: args.launchEntry,
      manualReadyUrl: args.manualReadyUrl ?? null,
      child: null,
      state: this.makeState(args.designId, 'starting', null, null, logs),
      logs,
      readyUrlTimer: null,
      readyDeferred: deferred,
      stopRequested: false,
    };
    this.slots.set(args.designId, slot);
    this.transition(slot, 'starting');

    const { command, commandArgs, displayCommand } = this.resolveCommand(
      args.packageManager,
      args.launchEntry,
    );

    let child: ChildProcess;
    try {
      child = spawn(command, commandArgs, {
        cwd: args.workspacePath,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          CI: '1',
        },
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(slot, 'launch', message, displayCommand);
      return;
    }

    slot.child = child;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onStdout(slot, chunk));
    child.stderr?.on('data', (chunk: string) => this.onStderr(slot, chunk));
    child.on('error', (err) => {
      // Typically EACCES or ENOENT — surfaced before exit fires.
      this.fail(slot, 'launch', err.message, displayCommand);
    });
    child.on('exit', (code, signal) => this.onExit(slot, code, signal, displayCommand));

    // Bound the wait for ready URL. Hot reload servers that never print a
    // matching line will trip this timeout and surface as an error rather
    // than hang the UI.
    slot.readyUrlTimer = setTimeout(() => {
      if (slot.state.status === 'starting') {
        this.fail(
          slot,
          'timeout',
          `ready URL not detected within ${READY_URL_TIMEOUT_MS / 1000}s`,
          displayCommand,
        );
      }
    }, READY_URL_TIMEOUT_MS);

    // Manual override: fall back to the user-supplied URL after a short
    // grace window if stdout never produced a parseable one. We do not
    // race this against detection \u2014 detection takes the slot first via
    // markReady() and clears both timers, so this only fires when we still
    // don't have a real URL.
    const manual = args.manualReadyUrl;
    if (manual !== undefined && manual !== null && manual !== '') {
      setTimeout(() => {
        if (slot.state.status === 'starting') {
          this.markReady(slot, manual);
        }
      }, MANUAL_READY_URL_GRACE_MS);
    }
  }

  /** Stop the dev server. SIGTERM with a grace window, then SIGKILL. */
  async stop(designId: string): Promise<EngineeringRunState> {
    const slot = this.slots.get(designId);
    if (slot === undefined || slot.child === null) {
      // Nothing to stop — return the last known state or a synthetic stopped one.
      const state =
        slot?.state ??
        this.makeState(designId, 'stopped', null, null, new LogRingBuffer(LOG_RING_CAPACITY));
      return state;
    }
    slot.stopRequested = true;
    const child = slot.child;

    return new Promise<EngineeringRunState>((resolve) => {
      const onExit = () => {
        // The 'exit' handler installed in start() already runs first and
        // transitions the FSM to 'stopped'. We just resolve once that is
        // observed.
        resolve(slot.state);
      };
      child.once('exit', onExit);
      try {
        child.kill('SIGTERM');
      } catch (err) {
        logger.warn('SIGTERM failed', { designId, err: String(err) });
      }
      setTimeout(() => {
        if (slot.child !== null) {
          try {
            slot.child.kill('SIGKILL');
          } catch (err) {
            logger.warn('SIGKILL failed', { designId, err: String(err) });
          }
        }
      }, STOP_SIGTERM_GRACE_MS);
    });
  }

  /** Tell subscribers that a manual reload was requested. Does not restart
   *  the child — the renderer remounts the iframe to apply the refresh. */
  refresh(designId: string): { ok: true } {
    const slot = this.slots.get(designId);
    if (slot !== undefined) {
      // Re-broadcast the current state so the renderer can reset its iframe
      // key. We bump updatedAt so the listener fires.
      slot.state = { ...slot.state, updatedAt: new Date().toISOString() };
      this.emit('run-state', slot.state);
    }
    return { ok: true };
  }

  /** Best-effort cleanup at app quit. */
  shutdownAll(): void {
    for (const slot of this.slots.values()) {
      if (slot.child !== null) {
        slot.stopRequested = true;
        try {
          slot.child.kill('SIGTERM');
        } catch {
          // noop — process may already be gone
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private resolveCommand(
    pm: EngineeringPackageManager,
    entry: LaunchEntry,
  ): { command: string; commandArgs: string[]; displayCommand: string } {
    if (entry.kind === 'package-script') {
      return {
        command: pm,
        commandArgs: ['run', entry.value],
        displayCommand: `${pm} run ${entry.value}`,
      };
    }
    // repo-local-command — split on whitespace. Quoted args / shell features
    // are intentionally not supported in v1; if a project needs them, it can
    // wrap the command in a package script.
    const parts = entry.value.trim().split(/\s+/);
    const head = parts[0] ?? '';
    return {
      command: head,
      commandArgs: parts.slice(1),
      displayCommand: entry.value,
    };
  }

  private onStdout(slot: RunSlot, chunk: string): void {
    this.recordLog(slot, 'stdout', chunk);
    if (slot.state.status === 'starting') {
      const url = extractReadyUrl(chunk);
      if (url !== null) {
        this.markReady(slot, url);
      }
    }
  }

  private onStderr(slot: RunSlot, chunk: string): void {
    this.recordLog(slot, 'stderr', chunk);
    // Some dev servers (Next.js) print their ready line on stderr.
    if (slot.state.status === 'starting') {
      const url = extractReadyUrl(chunk);
      if (url !== null) {
        this.markReady(slot, url);
      }
    }
  }

  private recordLog(slot: RunSlot, stream: 'stdout' | 'stderr', chunk: string): void {
    const lines = chunk.split(/\r?\n/);
    for (const text of lines) {
      if (text === '') continue;
      const line = slot.logs.push(stream, text);
      this.emit('log', { designId: slot.designId, line });
    }
  }

  private markReady(slot: RunSlot, url: string): void {
    if (slot.readyUrlTimer !== null) {
      clearTimeout(slot.readyUrlTimer);
      slot.readyUrlTimer = null;
    }
    slot.state = {
      ...this.makeState(slot.designId, 'running', url, null, slot.logs),
    };
    this.emit('run-state', slot.state);

    // Persist the last successful ready URL so subsequent starts can warm up
    // faster (and the UI can preview the saved URL while waiting for the new
    // dev server to boot).
    try {
      writeEngineeringSettings(slot.workspacePath, {
        schemaVersion: 1,
        framework: 'react',
        packageManager: slot.packageManager,
        launchEntry: slot.launchEntry,
        lastReadyUrl: url,
        manualReadyUrl: slot.manualReadyUrl,
      });
    } catch (err) {
      logger.warn('failed to persist lastReadyUrl', {
        designId: slot.designId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    slot.readyDeferred?.resolve(slot.state);
    slot.readyDeferred = null;
  }

  private onExit(
    slot: RunSlot,
    code: number | null,
    signal: NodeJS.Signals | null,
    displayCommand: string,
  ): void {
    if (slot.readyUrlTimer !== null) {
      clearTimeout(slot.readyUrlTimer);
      slot.readyUrlTimer = null;
    }
    const child = slot.child;
    slot.child = null;

    if (slot.stopRequested) {
      slot.state = this.makeState(slot.designId, 'stopped', null, null, slot.logs);
      this.emit('run-state', slot.state);
      // If start() is still pending (user stopped before ready), resolve.
      slot.readyDeferred?.resolve(slot.state);
      slot.readyDeferred = null;
      return;
    }

    // Unexpected exit. Code 0 → treat as stopped; non-zero → crash.
    const isCrash = (code !== null && code !== 0) || signal !== null;
    if (isCrash) {
      const reason =
        signal !== null ? `child terminated by signal ${signal}` : `child exited with code ${code}`;
      this.fail(slot, 'crash', reason, displayCommand);
    } else {
      slot.state = this.makeState(slot.designId, 'stopped', null, null, slot.logs);
      this.emit('run-state', slot.state);
      slot.readyDeferred?.resolve(slot.state);
      slot.readyDeferred = null;
    }
    // Drop child reference defensively (already set to null above; keep the
    // explicit reference here so static analysis doesn't claim it leaks).
    void child;
  }

  private fail(slot: RunSlot, kind: EngineeringErrorKind, message: string, command: string): void {
    if (slot.readyUrlTimer !== null) {
      clearTimeout(slot.readyUrlTimer);
      slot.readyUrlTimer = null;
    }
    if (slot.child !== null) {
      try {
        slot.child.kill('SIGTERM');
      } catch {
        // noop
      }
      slot.child = null;
    }

    const error: EngineeringError = {
      schemaVersion: 1,
      kind,
      message,
      excerpt: slot.logs.tail(ERROR_EXCERPT_LINES),
      command,
    };
    slot.state = this.makeState(slot.designId, 'error', null, error, slot.logs);
    this.emit('run-state', slot.state);
    slot.readyDeferred?.resolve(slot.state);
    slot.readyDeferred = null;
  }

  private transition(slot: RunSlot, status: EngineeringStatus): void {
    slot.state = this.makeState(
      slot.designId,
      status,
      slot.state.readyUrl,
      slot.state.lastError,
      slot.logs,
    );
    this.emit('run-state', slot.state);
  }

  private makeState(
    designId: string,
    status: EngineeringStatus,
    readyUrl: string | null,
    lastError: EngineeringError | null,
    logs: LogRingBuffer,
  ): EngineeringRunState {
    return {
      schemaVersion: 1,
      designId,
      status,
      readyUrl,
      lastError,
      logs: logs.snapshot(),
      updatedAt: new Date().toISOString(),
    };
  }
}

let singleton: EngineeringRuntime | null = null;

/** Lazily-initialised process-wide engineering runtime. Lazy so the runtime
 *  isn't constructed until the first engineering-mode session is opened —
 *  honors the "lazy-load heavy features" project constraint. */
export function getEngineeringRuntime(): EngineeringRuntime {
  if (singleton === null) {
    singleton = new EngineeringRuntime();
  }
  return singleton;
}
