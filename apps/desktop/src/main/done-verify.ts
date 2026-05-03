/**
 * Hidden BrowserWindow runtime verifier for the agent's `done` tool.
 *
 * The agent emits a JSX module (TWEAK_DEFAULTS + App + ReactDOM.createRoot).
 * We wrap it via `@open-codesign/runtime`'s `buildSrcdoc` (same path the
 * preview iframe uses), load it into an off-screen sandboxed BrowserWindow,
 * and capture every `console-message` (warn/error) plus `did-fail-load`
 * for ~3 s. The collected errors flow back through the `done` tool so the
 * agent can self-heal.
 *
 * Not unit-tested: hidden BrowserWindow + Babel runtime is not viable in
 * vitest. Manual verification path: run `pnpm dev`, send a prompt that
 * provokes a ReferenceError (e.g. unbound identifier inside `App`), and
 * confirm the next `done` tool result lists the error.
 */

import type { DoneError, DoneRuntimeVerifier } from '@open-codesign/core';
import { buildSrcdoc } from '@open-codesign/runtime';
import { BrowserWindow } from './electron-runtime';

const VERIFY_TIMEOUT_MS = 3000;
// Settle window: how long we wait after the page reports `did-finish-load`
// for late console errors (e.g. errors thrown inside Babel-transpiled JSX
// after the initial render). Short enough that the total is still <= 3s.
const SETTLE_AFTER_LOAD_MS = 1200;

export function makeRuntimeVerifier(): DoneRuntimeVerifier {
  return async (artifactSource: string): Promise<DoneError[]> => {
    const srcdoc = buildSrcdoc(artifactSource);
    // data: URL keeps everything self-contained; no temp file to clean up.
    // base64 sidesteps URL-encoding pitfalls for the embedded srcdoc.
    const dataUrl = `data:text/html;base64,${Buffer.from(srcdoc, 'utf8').toString('base64')}`;

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
      },
    });

    const errors: DoneError[] = [];
    const seen = new Set<string>();
    function pushError(message: string, source: string, lineno?: number): void {
      const key = `${source}|${lineno ?? ''}|${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      errors.push(lineno !== undefined ? { message, source, lineno } : { message, source });
    }

    type ConsoleMessageEvent = {
      level: 'verbose' | 'info' | 'warning' | 'error' | number;
      message: string;
      // Electron < 35 emits `line` (positional), 35+ emits an Event object
      // with `lineNumber`. Accept both so the listener survives the signature
      // change without a runtime branch at every call site.
      line?: number;
      lineNumber?: number;
      sourceId?: string;
    };

    const onConsole = (...args: unknown[]) => {
      // Electron 35+ emits a single Event-like object; older majors emit
      // positional (event, level, message, line, sourceId). Detect by
      // arity: a single object argument means the new shape.
      let level: ConsoleMessageEvent['level'];
      let message: string;
      let line: number | undefined;
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const e = args[0] as ConsoleMessageEvent;
        level = e.level;
        message = e.message;
        line = e.lineNumber ?? e.line;
      } else {
        level = args[1] as ConsoleMessageEvent['level'];
        message = args[2] as string;
        line = args[3] as number | undefined;
      }
      // Electron <26 emits a numeric level (0-3); newer builds emit a string.
      const isError = level === 'error' || level === 3;
      const isWarning = level === 'warning' || level === 2;
      if (!isError && !isWarning) return;
      pushError(message, isError ? 'console.error' : 'console.warning', line);
    };
    const onFailLoad = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
    ) => {
      pushError(`did-fail-load (${errorCode}): ${errorDescription} [${validatedURL}]`, 'load');
    };
    const onPreloadError = (_event: unknown, _preloadPath: string, error: Error) => {
      pushError(`preload-error: ${error.message}`, 'preload');
    };

    try {
      // Cast through `any` for the event-name overloads: Electron's WebContents
      // event union doesn't include 'did-fail-load' / 'preload-error' in the
      // overload set this TS lib resolves, even though the events fire at runtime.
      const wc = win.webContents as unknown as {
        on: (event: string, listener: (...args: unknown[]) => void) => void;
        once: (event: string, listener: (...args: unknown[]) => void) => void;
      };
      wc.on('console-message', onConsole as (...args: unknown[]) => void);
      wc.on('did-fail-load', onFailLoad as (...args: unknown[]) => void);
      wc.on('preload-error', onPreloadError as (...args: unknown[]) => void);

      // Race load+settle vs hard timeout. Both branches resolve to errors[].
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        const hardTimeout = setTimeout(finish, VERIFY_TIMEOUT_MS);
        const onFinish = () => {
          // Give the runtime a moment to throw any async errors after first paint.
          setTimeout(() => {
            clearTimeout(hardTimeout);
            finish();
          }, SETTLE_AFTER_LOAD_MS);
        };
        wc.once('did-finish-load', onFinish as (...args: unknown[]) => void);
        wc.once('did-fail-load', () => {
          clearTimeout(hardTimeout);
          finish();
        });
        void win.loadURL(dataUrl).catch((err: unknown) => {
          pushError(`loadURL failed: ${err instanceof Error ? err.message : String(err)}`, 'load');
          clearTimeout(hardTimeout);
          finish();
        });
      });
    } finally {
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* noop */
      }
    }

    return errors;
  };
}
