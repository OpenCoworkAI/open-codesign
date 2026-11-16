import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PreviewResult } from '@open-codesign/core';
import { CodesignError, type Design, type LibraryDesignSystemDetail } from '@open-codesign/shared';
import { DesignSystemLibrary } from './design-system-library';
import { app, dialog, ipcMain } from './electron-runtime';
import { resolveBundledTemplatesDir } from './ensure-user-templates';
import { type RunPreviewOptions, runPreview } from './preview-runtime';
import {
  createDesign,
  createSnapshot,
  type Database,
  deleteDesignForRollback,
  getDesign,
  markDesignSystemEditor,
  renameDesign,
  softDeleteDesign,
  updateDesignWorkspace,
} from './snapshots-db';

export function getDesignSystemLibrary(): DesignSystemLibrary {
  // Built-in references are always the immutable copies shipped with this build.
  // `<userData>/templates/brand-refs` is user-owned (and may hold legacy docs),
  // so it must never be read as the built-in source.
  const templatesDir = resolveBundledTemplatesDir(process.resourcesPath);
  if (!templatesDir)
    throw new CodesignError('Bundled design system references are unavailable', 'IPC_NOT_FOUND');
  return new DesignSystemLibrary({
    root: path.join(app.getPath('userData'), 'design-systems'),
    builtinRoot: path.join(templatesDir, 'brand-refs'),
  });
}

type PreviewRunner = (options: RunPreviewOptions) => Promise<PreviewResult>;
let editorBusy: (designId: string) => boolean = () => false;
export function registerDesignSystemLibraryBusyCheck(
  check: (designId: string) => boolean,
): () => void {
  editorBusy = check;
  return () => {
    if (editorBusy === check) editorBusy = () => false;
  };
}
function assertEditorIdle(detail: LibraryDesignSystemDetail): void {
  if (detail.system.sessionDesignId && editorBusy(detail.system.sessionDesignId))
    throw new CodesignError(
      'Wait for design system generation to finish. / 请等待设计系统生成完成。',
      'IPC_CONFLICT',
    );
}
export async function validateLibrarySystem(
  library: DesignSystemLibrary,
  id: string,
  runner: PreviewRunner = runPreview,
): Promise<LibraryDesignSystemDetail> {
  assertEditorIdle(await library.get(id));
  const detail = await library.syncPreview(id);
  let workspaceRoot = detail.system.workspacePath;
  let temp: string | null = null;
  let issues = [...detail.system.issues];
  let screenshot: string | null = null;
  try {
    if (detail.system.builtin) {
      temp = await mkdtemp(path.join(tmpdir(), 'codesign-system-preview-'));
      workspaceRoot = temp;
      await writeFile(path.join(temp, 'App.jsx'), detail.previewSource);
    }
    // Old runtime failures are retried; only current schema errors block rendering.
    const { validateDesignMd } = await import('@open-codesign/shared/design-md');
    issues = validateDesignMd(detail.designMd)
      .filter((f) => f.severity === 'error')
      .map((f) => `${f.path}: ${f.message}`);
    if (issues.length === 0) {
      const report = await runner({
        workspaceRoot,
        path: 'App.jsx',
        vision: true,
        viewport: { width: 1280, height: 960 },
        steps: [
          {
            action: 'click',
            selector: '[data-design-system-role="primary-button"]:not([disabled])',
          },
          {
            action: 'assert',
            selector: '[data-design-system-role="primary-button"]:not([disabled])',
            visible: true,
          },
          {
            action: 'click',
            selector: '[data-design-system="components.navigation"] button:first-child',
          },
        ],
      });
      if (!report.ok) issues.push(report.reason ?? 'Preview verification failed');
      issues.push(
        ...report.consoleErrors.filter((e) => e.level === 'error').map((e) => e.message),
        ...report.assetErrors.map((e) => `Asset: ${e.url}`),
      );
      if (issues.length === 0) screenshot = report.screenshot ?? null;
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
  }
  const system = await library.recordValidation(id, detail.fingerprint, issues, screenshot);
  return { ...detail, system };
}

export async function applyLibrarySystem(id: string, workspacePath: string): Promise<void> {
  const library = getDesignSystemLibrary();
  const checked = await validateLibrarySystem(library, id);
  if (checked.system.status !== 'ready')
    throw new CodesignError(checked.system.issues.join('\n'), 'IPC_BAD_INPUT');
  try {
    await library.apply(id, workspacePath);
  } catch (cause) {
    throw new CodesignError(
      cause instanceof Error ? cause.message : String(cause),
      'IPC_CONFLICT',
      { cause },
    );
  }
}

const editorLocks = new Map<string, Promise<Design>>();
export function openDesignSystemEditor(
  db: Database,
  library: DesignSystemLibrary,
  id: string,
): Promise<Design> {
  const pending = editorLocks.get(id);
  if (pending) return pending;
  const opening = (async () => {
    const detail = await library.get(id);
    if (detail.system.builtin)
      throw new Error('Create your own copy before editing a built-in system');
    const existing = detail.system.sessionDesignId
      ? getDesign(db, detail.system.sessionDesignId)
      : null;
    if (
      existing &&
      !existing.deletedAt &&
      existing.designSystemId === id &&
      existing.workspacePath &&
      path.resolve(existing.workspacePath) === path.resolve(detail.system.workspacePath)
    )
      return existing;
    const design = createDesign(db, detail.system.name);
    try {
      updateDesignWorkspace(db, design.id, detail.system.workspacePath, 'blank-canvas');
      const editor = markDesignSystemEditor(db, design.id, id);
      createSnapshot(db, {
        designId: editor.id,
        parentId: null,
        type: 'initial',
        prompt: null,
        artifactType: 'react',
        artifactSource: detail.previewSource,
      });
      await library.update(id, { sessionDesignId: editor.id });
      return editor;
    } catch (error) {
      deleteDesignForRollback(db, design.id);
      throw error;
    }
  })();
  editorLocks.set(id, opening);
  void opening
    .finally(() => {
      if (editorLocks.get(id) === opening) editorLocks.delete(id);
    })
    .catch(() => {});
  return opening;
}

function payload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>)['schemaVersion'] !== 1)
    throw new CodesignError('Invalid design system request', 'IPC_BAD_INPUT');
  return raw as Record<string, unknown>;
}
function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    throw new CodesignError(`Invalid ${key}`, 'IPC_BAD_INPUT');
  return value;
}

export function registerDesignSystemLibraryIpc(
  db: Database,
  providedLibrary?: DesignSystemLibrary,
  runner: PreviewRunner = runPreview,
): void {
  const handle = (
    action: string,
    callback: (input: Record<string, unknown>, library: DesignSystemLibrary) => unknown,
  ) => {
    ipcMain.handle(`design-systems:v1:${action}`, (_event: unknown, raw: unknown) => {
      const input = payload(raw);
      return callback(input, providedLibrary ?? getDesignSystemLibrary());
    });
  };
  handle('list', (_p, library) => library.list());
  handle('get', (p, library) => library.get(text(p, 'id')));
  handle('create', (p, library) =>
    library.create({
      name: text(p, 'name'),
      ...(typeof p['description'] === 'string' ? { description: p['description'] } : {}),
    }),
  );
  handle('fork', async (p, library) => {
    assertEditorIdle(await library.get(text(p, 'id')));
    return library.fork(text(p, 'id'), typeof p['name'] === 'string' ? p['name'] : undefined);
  });
  handle('edit', (p, library) => openDesignSystemEditor(db, library, text(p, 'id')));
  handle('validate', (p, library) => validateLibrarySystem(library, text(p, 'id'), runner));
  handle('update', async (p, library) => {
    assertEditorIdle(await library.get(text(p, 'id')));
    const detail = await library.update(text(p, 'id'), {
      name: text(p, 'name'),
      description: typeof p['description'] === 'string' ? p['description'] : '',
    });
    if (detail.system.sessionDesignId)
      renameDesign(db, detail.system.sessionDesignId, detail.system.name);
    return detail;
  });
  handle('import', async (p, library) => {
    if (p['designId'] !== undefined) {
      const source = getDesign(db, text(p, 'designId'));
      if (!source?.workspacePath || source.deletedAt) throw new Error('Design workspace not found');
      if (editorBusy(source.id))
        throw new CodesignError(
          'Wait for generation to finish before importing this design.',
          'IPC_CONFLICT',
        );
      return library.importFile(
        path.join(source.workspacePath, 'DESIGN.md'),
        `${source.name} system`,
      );
    }
    const selected = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'DESIGN.md', extensions: ['md'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return library.importFile(selected.filePaths[0]);
  });
  handle('delete', async (p, library) => {
    const detail = await library.get(text(p, 'id'));
    assertEditorIdle(detail);
    await library.remove(detail.system.id);
    if (detail.system.sessionDesignId) softDeleteDesign(db, detail.system.sessionDesignId);
  });
  handle('export', async (p, library) => {
    const detail = await library.get(text(p, 'id'));
    const selected = await dialog.showSaveDialog({
      defaultPath: 'DESIGN.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!selected.canceled && selected.filePath)
      await writeFile(selected.filePath, detail.designMd, 'utf8');
    return selected.canceled ? null : (selected.filePath ?? null);
  });
}
