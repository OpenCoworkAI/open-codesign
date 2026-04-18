/**
 * Minimal logger interface used by `generate()` and `applyComment()` to emit
 * step-named structured events. The desktop main process injects a wrapper
 * around its electron-log scope; tests pass a spy. Defaults to a no-op so
 * library consumers without logging needs pay nothing.
 *
 * Each event uses the convention `step=<name>` plus a phase suffix:
 *   - `[generate] step=<name>` (start, with provider+model context)
 *   - `[generate] step=<name>.ok` (success, with timing)
 *   - `[generate] step=<name>.fail` (error, with class + status code)
 */

export interface CoreLogger {
  info: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
}

export const NOOP_LOGGER: CoreLogger = {
  info: () => {},
  error: () => {},
};
