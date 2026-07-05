import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { type ExporterFormat, type ExportOptions, exportArtifact } from '@open-codesign/exporters';
import {
  classifyRenderableSource,
  findArtifactSourceReference,
  resolveArtifactSourceReferencePath,
} from '@open-codesign/runtime';
import {
  CodesignError,
  DEFAULT_SOURCE_ENTRY,
  ERROR_CODES,
  LEGACY_SOURCE_ENTRY,
} from '@open-codesign/shared';
import type { BrowserWindow } from 'electron';
import { app, dialog, ipcMain } from './electron-runtime';
import { type Database, getDesign } from './snapshots-db';
import { readWorkspaceFileAt } from './workspace-reader';

const FORMAT_FILTERS: Record<ExporterFormat, Electron.FileFilter[]> = {
  html: [{ name: 'HTML', extensions: ['html'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  pptx: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  zip: [{ name: 'ZIP archive', extensions: ['zip'] }],
  markdown: [{ name: 'Markdown', extensions: ['md'] }],
};

function hasUrlSchemePrefix(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon <= 0) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*$/u.test(value.slice(0, colon));
}

function normalizeExportSourcePath(raw: string): string {
  let normalized = raw.trim().replace(/\\/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    hasUrlSchemePrefix(normalized)
  ) {
    throw new CodesignError(
      'export sourcePath must be workspace-relative',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new CodesignError(
      'export sourcePath must be workspace-relative',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return normalized;
}

export interface ExportRequest {
  format: ExporterFormat;
  artifactSource: string;
  defaultFilename?: string;
  designId?: string;
  designName?: string;
  workspacePath?: string;
  sourcePath?: string;
}

export interface ExportResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
export function parseRequest(raw: unknown): ExportRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError('export expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const format = r['format'];
  const source = r['artifactSource'];
  const defaultFilename = r['defaultFilename'];
  const designId = r['designId'];
  const designName = r['designName'];
  const workspacePath = r['workspacePath'];
  const sourcePath = r['sourcePath'];
  if (
    format !== 'html' &&
    format !== 'pdf' &&
    format !== 'pptx' &&
    format !== 'zip' &&
    format !== 'markdown'
  ) {
    throw new CodesignError(
      `Unknown export format: ${String(format)}`,
      ERROR_CODES.EXPORTER_UNKNOWN,
    );
  }
  if (typeof source !== 'string' || source.length === 0) {
    throw new CodesignError('export requires non-empty artifactSource', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: ExportRequest = { format, artifactSource: source };
  if (typeof defaultFilename === 'string' && defaultFilename.length > 0) {
    out.defaultFilename = defaultFilename;
  }
  if (typeof designId === 'string' && designId.trim().length > 0) {
    out.designId = designId.trim();
  }
  if (typeof designName === 'string' && designName.trim().length > 0) {
    out.designName = designName.trim();
  }
  if (typeof workspacePath === 'string' && workspacePath.length > 0) {
    out.workspacePath = workspacePath;
  }
  if (typeof sourcePath === 'string' && sourcePath.length > 0) {
    out.sourcePath = normalizeExportSourcePath(sourcePath);
  }
  return out;
}

export interface ResolvedExportSource extends ExportRequest {
  sourcePath: string;
}

export function extensionForFormat(format: ExporterFormat): string {
  return format === 'markdown' ? 'md' : format;
}

export function ensureExportExtension(filePath: string, format: ExporterFormat): string {
  const ext = `.${extensionForFormat(format)}`;
  return path.extname(filePath).toLowerCase() === ext ? filePath : `${filePath}${ext}`;
}

export function buildDefaultExportPath(input: {
  format: ExporterFormat;
  downloadsPath: string;
  defaultFilename?: string | undefined;
  designName?: string | undefined;
  sourcePath?: string | undefined;
  now?: Date | undefined;
}): string {
  if (input.defaultFilename && input.defaultFilename.trim().length > 0) {
    return ensureExportExtension(
      path.join(input.downloadsPath, normalizeDefaultFilename(input.defaultFilename)),
      input.format,
    );
  }
  const design = sanitizeFilenamePart(input.designName ?? '') || 'open-codesign';
  const source =
    sanitizeFilenamePart(sourceStem(input.sourcePath ?? DEFAULT_SOURCE_ENTRY)) || 'App';
  const stamp = formatTimestamp(input.now ?? new Date());
  const filename = `${design}-${source}-${stamp}.${extensionForFormat(input.format)}`;
  return path.join(input.downloadsPath, filename);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
export async function resolveExportSource(
  req: ExportRequest,
  deps: { db?: Database | null } = {},
): Promise<ResolvedExportSource> {
  const fromDb = req.designId && deps.db ? getDesign(deps.db, req.designId) : null;
  const designName = req.designName ?? fromDb?.name;
  const workspacePath = req.workspacePath ?? fromDb?.workspacePath ?? undefined;
  const base = {
    ...req,
    ...(designName ? { designName } : {}),
    ...(workspacePath ? { workspacePath } : {}),
  };

  if (!workspacePath) {
    return { ...base, sourcePath: req.sourcePath ?? DEFAULT_SOURCE_ENTRY };
  }

  const candidates = req.sourcePath
    ? [req.sourcePath]
    : [DEFAULT_SOURCE_ENTRY, 'App.tsx', LEGACY_SOURCE_ENTRY];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const source = await readWorkspaceFileAt(workspacePath, candidate);
      if (source.content.trim().length === 0) continue;
      const referenced = referencedSourcePath(source.content, source.path);
      if (referenced !== null) {
        const resolved = await readWorkspaceFileAt(workspacePath, referenced);
        if (resolved.content.trim().length === 0) {
          throw new CodesignError(
            `Referenced export source is empty: ${referenced}`,
            ERROR_CODES.IPC_BAD_INPUT,
          );
        }
        return { ...base, artifactSource: resolved.content, sourcePath: resolved.path };
      }
      return { ...base, artifactSource: source.content, sourcePath: source.path };
    } catch (err) {
      lastError = err;
      if (req.sourcePath) break;
    }
  }

  if (req.sourcePath) {
    throw new CodesignError(
      `Export source file not found: ${req.sourcePath}`,
      ERROR_CODES.IPC_BAD_INPUT,
      { cause: lastError },
    );
  }

  return { ...base, sourcePath: DEFAULT_SOURCE_ENTRY };
}

export function exportAssetOptions(req: ExportRequest): ExportOptions {
  const sourcePath = req.sourcePath ?? DEFAULT_SOURCE_ENTRY;
  if (!req.workspacePath) return { sourcePath };
  const sourceDir = path.dirname(sourcePath);
  return {
    assetRootPath: req.workspacePath,
    assetBasePath: path.resolve(req.workspacePath, sourceDir),
    sourcePath,
  };
}

export function registerExporterIpc(
  getWindow: () => BrowserWindow | null,
  db: Database | null = null,
): void {
  ipcMain.handle('codesign:export', async (_evt, raw: unknown): Promise<ExportResponse> => {
    const req = parseRequest(raw);
    const resolved = await resolveExportSource(req, { db });
    const win = getWindow();
    const defaultPath = buildDefaultExportPath({
      format: req.format,
      downloadsPath: app.getPath('downloads'),
      defaultFilename: req.defaultFilename,
      designName: resolved.designName,
      sourcePath: resolved.sourcePath,
    });
    if (path.isAbsolute(defaultPath)) {
      await mkdir(path.dirname(defaultPath), { recursive: true });
    }
    const opts: Electron.SaveDialogOptions = {
      title: `Export design as ${req.format.toUpperCase()}`,
      defaultPath,
      filters: FORMAT_FILTERS[req.format],
    };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) {
      return { status: 'cancelled' };
    }

    // Export formats load their heavy deps lazily inside
    // exportArtifact. Errors propagate to the renderer as toasts (PRINCIPLES §10).
    const destinationPath = ensureExportExtension(picked.filePath, req.format);
    const result = await exportArtifact(
      req.format,
      resolved.artifactSource,
      destinationPath,
      exportAssetOptions(resolved),
    );
    return { status: 'saved', path: result.path, bytes: result.bytes };
  });
}

function referencedSourcePath(source: string, currentPath: string): string | null {
  if (classifyRenderableSource(source, currentPath) !== 'html') return null;
  const reference = findArtifactSourceReference(source);
  return reference === null ? null : resolveArtifactSourceReferencePath(currentPath, reference);
}

function sourceStem(sourcePath: string): string {
  const basename = path.basename(sourcePath.replace(/\\/g, '/'));
  const ext = path.extname(basename);
  return ext ? basename.slice(0, -ext.length) : basename;
}

function normalizeDefaultFilename(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  const basename = path.basename(normalized);
  const sanitized = sanitizeFilenamePart(basename);
  return sanitized || 'open-codesign-export';
}

function sanitizeFilenamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._ -]/gu, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+$/u, '')
    .slice(0, 64);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  const day = [
    date.getUTCFullYear().toString(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-');
  return `${day}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds(),
  )}`;
}
