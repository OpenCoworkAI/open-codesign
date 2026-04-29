/**
 * Engineering-mode IPC handlers (main process).
 *
 * Channel namespace: engine:v1:*. All payloads carry schemaVersion: 1.
 *
 * Sequencing for a fresh engineering-mode design (renderer drives this):
 *   1. snapshots:v1:create-design — create the row (mode='generative' default)
 *   2. snapshots:v1:workspace:pick / :update — bind the workspace folder
 *   3. engine:v1:detect — surface candidate launch entries
 *   4. engine:v1:session:create — flips mode to 'engineering' and persists
 *      the chosen launchEntry + packageManager
 *   5. engine:v1:start — runs install (if needed) then spawns the dev server
 *   6. engine:v1:stop / :refresh — lifecycle controls
 *
 * Run-state and log events are broadcast from the runtime EventEmitter to
 * every BrowserWindow via webContents.send so the renderer can subscribe in
 * the preload bridge without opaque IPC channel names.
 */

import { OVERLAY_SCRIPT, REACT_INSPECTOR_SCRIPT } from '@open-codesign/runtime';
import type {
  Design,
  EngineeringConfig,
  EngineeringRunState,
  LaunchEntry,
} from '@open-codesign/shared';
import { CodesignError, EngineeringConfigV1, LaunchEntryV1 } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { BrowserWindow } from 'electron';
import { ipcMain } from './electron-runtime';
import { detect, validateLaunchEntry } from './engineering/detector';
import { getEngineeringRuntime } from './engineering/runtime';
import { writeEngineeringSettings } from './engineering/settings';
import { getLogger } from './logger';
import {
  createDesign,
  getDesign,
  setDesignMode,
  setEngineeringConfig,
  updateDesignWorkspace,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

const logger = getLogger('engineering-ipc');

function requireSchemaV1(r: Record<string, unknown>, channel: string): void {
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, 'IPC_BAD_INPUT');
  }
}

function requireString(r: Record<string, unknown>, key: string, channel: string): string {
  const value = r[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CodesignError(`${channel}: ${key} must be a non-empty string`, 'IPC_BAD_INPUT');
  }
  return value;
}

function requireDesignWithWorkspace(
  db: Database,
  designId: string,
): Design & { workspacePath: string } {
  const design = getDesign(db, designId);
  if (design === null) {
    throw new CodesignError(`design ${designId} not found`, 'IPC_BAD_INPUT');
  }
  if (design.workspacePath === null) {
    throw new CodesignError(`design ${designId} has no workspace bound`, 'IPC_BAD_INPUT');
  }
  return design as Design & { workspacePath: string };
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function registerEngineeringIpc(db: Database): void {
  const runtime = getEngineeringRuntime();

  // Forward runtime events to all windows. Bound once per registration; the
  // runtime is a process-wide singleton so re-registration would double up.
  runtime.on('run-state', (state: EngineeringRunState) => {
    broadcast('engine:v1:run-state', state);
  });
  runtime.on('log', (entry) => {
    broadcast('engine:v1:log', entry);
  });

  ipcMain.handle('engine:v1:detect', async (_e, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('engine:v1:detect expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'engine:v1:detect');
    const workspacePath = requireString(r, 'workspacePath', 'engine:v1:detect');
    return detect(workspacePath);
  });

  ipcMain.handle('engine:v1:session:create', async (_e, raw: unknown): Promise<Design> => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError(
        'engine:v1:session:create expects an object payload',
        'IPC_BAD_INPUT',
      );
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'engine:v1:session:create');
    const workspacePath = requireString(r, 'workspacePath', 'engine:v1:session:create');

    // launchEntry is optional — when omitted we run detect() and pick the
    // top-confidence candidate. packageManager is always derived from
    // detection so the renderer never has to guess.
    let launchEntry: LaunchEntry | undefined;
    if (r['launchEntry'] !== undefined) {
      const parsed = LaunchEntryV1.safeParse(r['launchEntry']);
      if (!parsed.success) {
        throw new CodesignError('engine:v1:session:create: invalid launchEntry', 'IPC_BAD_INPUT');
      }
      launchEntry = validateLaunchEntry(parsed.data);
    }
    let manualReadyUrl: string | null = null;
    if (r['manualReadyUrl'] !== undefined && r['manualReadyUrl'] !== null) {
      if (typeof r['manualReadyUrl'] !== 'string') {
        throw new CodesignError(
          'engine:v1:session:create: manualReadyUrl must be a string when provided',
          'IPC_BAD_INPUT',
        );
      }
      const trimmed = r['manualReadyUrl'].trim();
      if (trimmed !== '') {
        if (!/^https?:\/\//.test(trimmed)) {
          throw new CodesignError(
            'engine:v1:session:create: manualReadyUrl must start with http:// or https://',
            'IPC_BAD_INPUT',
          );
        }
        manualReadyUrl = trimmed;
      }
    }

    const detection = await detect(workspacePath);
    if (detection.framework !== 'react') {
      throw new CodesignError(
        `engine:v1:session:create: workspace is not a React project (${detection.reason ?? 'unknown'})`,
        'IPC_BAD_INPUT',
      );
    }
    const packageManager = detection.packageManager;
    launchEntry ??= detection.launchEntries[0];
    if (launchEntry === undefined || packageManager === null) {
      throw new CodesignError(
        'engine:v1:session:create: could not auto-detect a launch entry; pick one manually',
        'IPC_BAD_INPUT',
      );
    }

    // Derive the design name from the workspace folder so the sidebar isn't
    // littered with "Untitled design" entries when many engineering sessions
    // co-exist.
    const folderName =
      workspacePath
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? 'engineering';
    const created = createDesign(db, folderName);
    updateDesignWorkspace(db, created.id, workspacePath);

    const config: EngineeringConfig = {
      schemaVersion: 1,
      framework: 'react',
      packageManager,
      launchEntry,
      lastReadyUrl: detection.savedConfig?.lastReadyUrl ?? null,
      manualReadyUrl,
    };
    const safe = EngineeringConfigV1.parse(config);
    setDesignMode(db, created.id, 'engineering');
    setEngineeringConfig(db, created.id, safe);

    try {
      writeEngineeringSettings(workspacePath, safe);
    } catch (err) {
      logger.warn('writeEngineeringSettings failed', {
        designId: created.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const updated = getDesign(db, created.id);
    if (updated === null) {
      throw new CodesignError(
        'engine:v1:session:create: design vanished after update',
        'IPC_DB_ERROR',
      );
    }
    return updated;
  });

  ipcMain.handle('engine:v1:start', async (_e, raw: unknown): Promise<EngineeringRunState> => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('engine:v1:start expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'engine:v1:start');
    const designId = requireString(r, 'designId', 'engine:v1:start');
    const design = requireDesignWithWorkspace(db, designId);
    const config = design.engineering;
    if (config === undefined || config === null) {
      throw new CodesignError(
        `engine:v1:start: design ${designId} has no engineering config; call session:create first`,
        'IPC_BAD_INPUT',
      );
    }

    // Run install if needed, then spawn the dev server.
    const initState = await runtime.initializeDependencies({
      designId,
      workspacePath: design.workspacePath,
      packageManager: config.packageManager,
      launchEntry: config.launchEntry,
    });
    if (initState.status === 'error') {
      return initState;
    }
    return runtime.start({
      designId,
      workspacePath: design.workspacePath,
      packageManager: config.packageManager,
      launchEntry: config.launchEntry,
      manualReadyUrl: config.manualReadyUrl,
    });
  });

  ipcMain.handle('engine:v1:stop', async (_e, raw: unknown): Promise<EngineeringRunState> => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('engine:v1:stop expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'engine:v1:stop');
    const designId = requireString(r, 'designId', 'engine:v1:stop');
    return runtime.stop(designId);
  });

  ipcMain.handle('engine:v1:refresh', async (_e, raw: unknown): Promise<{ ok: true }> => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('engine:v1:refresh expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'engine:v1:refresh');
    const designId = requireString(r, 'designId', 'engine:v1:refresh');
    return runtime.refresh(designId);
  });

  ipcMain.handle(
    'engine:v1:save-launch-entry',
    async (_e, raw: unknown): Promise<EngineeringConfig> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'engine:v1:save-launch-entry expects an object payload',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'engine:v1:save-launch-entry');
      const designId = requireString(r, 'designId', 'engine:v1:save-launch-entry');
      const parsed = LaunchEntryV1.safeParse(r['launchEntry']);
      if (!parsed.success) {
        throw new CodesignError(
          'engine:v1:save-launch-entry: invalid launchEntry',
          'IPC_BAD_INPUT',
        );
      }
      const launchEntry = validateLaunchEntry(parsed.data);
      const design = requireDesignWithWorkspace(db, designId);
      const previous = design.engineering;
      if (previous === undefined || previous === null) {
        throw new CodesignError(
          'engine:v1:save-launch-entry: no engineering config to update; call session:create first',
          'IPC_BAD_INPUT',
        );
      }
      const next: EngineeringConfig = {
        schemaVersion: 1,
        framework: previous.framework,
        packageManager: previous.packageManager,
        launchEntry,
        lastReadyUrl: previous.lastReadyUrl,
        manualReadyUrl: previous.manualReadyUrl,
      };
      const safe = EngineeringConfigV1.parse(next);
      setEngineeringConfig(db, designId, safe);
      try {
        writeEngineeringSettings(design.workspacePath, safe);
      } catch (err) {
        logger.warn('writeEngineeringSettings failed', {
          designId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      return safe;
    },
  );

  ipcMain.handle('engine:v1:get-run-state', (_e, raw: unknown): EngineeringRunState | null => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('engine:v1:get-run-state expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'engine:v1:get-run-state');
    const designId = requireString(r, 'designId', 'engine:v1:get-run-state');
    return runtime.getRunState(designId);
  });

  // U12.1: bridge injection for cross-origin preview iframes.
  //
  // When the iframe points at the user's dev server (e.g. http://localhost:5173)
  // and the renderer is loaded from a different origin (file://, app://, or
  // even another localhost port), `iframe.contentDocument` is null because of
  // the Same-Origin Policy. The renderer-side injectOverlayBridge() therefore
  // fails with `no-document`. We work around it from main, where Electron's
  // webFrameMain API can executeJavaScript across origins.
  //
  // The renderer hands us a target URL prefix (its iframe `src`); we walk
  // every subframe of the calling webContents, match by URL prefix, and
  // inject overlay + react-inspector. Both scripts are idempotent IIFEs that
  // bail if they've already mounted, so re-firing on every load is safe.
  ipcMain.handle(
    'engine:v1:inject-bridge',
    async (e, raw: unknown): Promise<{ injected: number }> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'engine:v1:inject-bridge expects an object payload',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'engine:v1:inject-bridge');
      const targetUrl = requireString(r, 'targetUrl', 'engine:v1:inject-bridge');

      const sender = e.sender;
      if (sender.isDestroyed()) return { injected: 0 };

      // mainFrame.framesInSubtree includes the main frame itself; skip it.
      const candidates = sender.mainFrame.framesInSubtree.filter((f) => {
        if (f === sender.mainFrame) return false;
        const url = f.url;
        if (typeof url !== 'string' || url === '') return false;
        // Match by origin: strip query/hash/path so http://localhost:5173/foo
        // still matches a target of http://localhost:5173. Also accept exact
        // prefix match for callers that want to be specific.
        try {
          const a = new URL(url);
          const b = new URL(targetUrl);
          return a.origin === b.origin;
        } catch {
          return url.startsWith(targetUrl);
        }
      });

      let injected = 0;
      for (const frame of candidates) {
        try {
          // Combine both scripts into one round-trip. Each IIFE guards itself
          // against double-mount via window-level flags, so navigations that
          // re-fire the load event still re-mount cleanly because the global
          // gets reset with the new document.
          await frame.executeJavaScript(
            `${OVERLAY_SCRIPT};\n${REACT_INSPECTOR_SCRIPT};`,
            true /* userGesture — required for some sandboxed contexts */,
          );
          injected += 1;
        } catch (err) {
          logger.warn('inject-bridge: executeJavaScript failed', {
            url: frame.url,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { injected };
    },
  );
}

/** App-quit hook — terminate any running dev servers. */
export function shutdownEngineeringRuntime(): void {
  getEngineeringRuntime().shutdownAll();
}
