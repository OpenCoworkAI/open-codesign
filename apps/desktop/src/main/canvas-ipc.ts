import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { LocalInputFile } from '@open-codesign/shared';
import { app, ipcMain } from './electron-runtime';

interface CanvasStatePayload {
  sceneJson: string | null;
  importedFiles: Array<{
    path: string;
    name: string;
    size: number;
  }>;
}

function canvasStateDir(designId: string): string {
  return join(app.getPath('userData'), 'canvas-state', designId);
}

function canvasScenePath(designId: string): string {
  return join(canvasStateDir(designId), 'scene.excalidraw.json');
}

function canvasImportsPath(designId: string): string {
  return join(canvasStateDir(designId), 'imports.json');
}

function canvasExportDir(designId: string): string {
  return join(app.getPath('temp'), 'open-codesign-canvas-context', designId);
}

async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

function requireSchemaV1(raw: unknown, channel: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${channel} expects an object payload`);
  }
  const record = raw as Record<string, unknown>;
  if (record['schemaVersion'] !== 1) {
    throw new Error(`${channel} requires schemaVersion: 1`);
  }
  return record;
}

function requireDesignId(record: Record<string, unknown>, channel: string): string {
  const designId = record['designId'];
  if (typeof designId !== 'string' || designId.trim().length === 0) {
    throw new Error(`${channel} requires a non-empty designId`);
  }
  return designId;
}

function parseImportedFiles(raw: unknown): CanvasStatePayload['importedFiles'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => LocalInputFile.parse(entry))
    .map((file) => ({ path: file.path, name: file.name, size: file.size }));
}

function sanitizeFileName(name: string): string {
  const clean = basename(name).replace(/[^\w.\-]+/g, '-');
  return clean.length > 0 ? clean : 'canvas-context.txt';
}

export function registerCanvasIpc(): void {
  ipcMain.handle('canvas:v1:load-state', async (_event: unknown, raw: unknown) => {
    const record = requireSchemaV1(raw, 'canvas:v1:load-state');
    const designId = requireDesignId(record, 'canvas:v1:load-state');
    const [sceneJson, importsJson] = await Promise.all([
      readTextIfPresent(canvasScenePath(designId)),
      readTextIfPresent(canvasImportsPath(designId)),
    ]);

    let importedFiles: CanvasStatePayload['importedFiles'] = [];
    if (importsJson) {
      try {
        importedFiles = parseImportedFiles(JSON.parse(importsJson));
      } catch {
        importedFiles = [];
      }
    }

    return {
      sceneJson,
      importedFiles,
    } satisfies CanvasStatePayload;
  });

  ipcMain.handle('canvas:v1:save-state', async (_event: unknown, raw: unknown) => {
    const record = requireSchemaV1(raw, 'canvas:v1:save-state');
    const designId = requireDesignId(record, 'canvas:v1:save-state');
    const sceneJson = record['sceneJson'];
    if (sceneJson !== null && typeof sceneJson !== 'string') {
      throw new Error('canvas:v1:save-state requires sceneJson to be a string or null');
    }

    const importedFiles = parseImportedFiles(record['importedFiles']);
    await mkdir(canvasStateDir(designId), { recursive: true });
    await Promise.all([
      writeFile(canvasScenePath(designId), sceneJson ?? '', 'utf8'),
      writeFile(canvasImportsPath(designId), JSON.stringify(importedFiles, null, 2), 'utf8'),
    ]);
    return { ok: true as const };
  });

  ipcMain.handle('canvas:v1:write-context-files', async (_event: unknown, raw: unknown) => {
    const record = requireSchemaV1(raw, 'canvas:v1:write-context-files');
    const designId = requireDesignId(record, 'canvas:v1:write-context-files');
    const files = record['files'];
    if (!Array.isArray(files)) {
      throw new Error('canvas:v1:write-context-files requires files[]');
    }
    await mkdir(canvasExportDir(designId), { recursive: true });
    const stamp = Date.now().toString(36);
    const written = await Promise.all(
      files.map(async (entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
          throw new Error('canvas:v1:write-context-files received an invalid file entry');
        }
        const file = entry as Record<string, unknown>;
        const name = sanitizeFileName(
          typeof file['name'] === 'string' ? file['name'] : `canvas-context-${index + 1}.txt`,
        );
        const content = typeof file['content'] === 'string' ? file['content'] : '';
        const path = join(canvasExportDir(designId), `${stamp}-${index + 1}-${name}`);
        await writeFile(path, content, 'utf8');
        return LocalInputFile.parse({
          path,
          name,
          size: Buffer.byteLength(content, 'utf8'),
        });
      }),
    );
    return written;
  });
}
