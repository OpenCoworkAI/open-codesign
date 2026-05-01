import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { shutdownAllProcesses } from '../process-registry';
import type { Database } from '../snapshots-db';
import { registerGenerateIpc } from './generate';
import { registerPickerIpc } from './picker';
import { registerShellIpc } from './shell';

/**
 * Aggregates per-domain IPC registrations and returns a teardown closure.
 * `before-quit` calls the teardown to abort in-flight generations and stop
 * any spawned helpers tracked by `process-registry`.
 */
export function registerIpcHandlers(
  db: Database | null,
  getMainWindow: () => ElectronBrowserWindow | null,
): () => void {
  registerPickerIpc(getMainWindow);
  registerShellIpc();
  const teardownGenerate = registerGenerateIpc({ db, getMainWindow });

  return () => {
    teardownGenerate();
    shutdownAllProcesses();
  };
}
