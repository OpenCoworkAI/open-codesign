import { type ExporterFormat, exportArtifact } from '@open-codesign/exporters';
import { CodesignError } from '@open-codesign/shared';
import type { BrowserWindow } from 'electron';
import { dialog, ipcMain } from './electron-runtime';

const FORMAT_FILTERS: Record<ExporterFormat, Electron.FileFilter[]> = {
  html: [{ name: 'HTML', extensions: ['html'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  pptx: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  zip: [{ name: 'ZIP archive', extensions: ['zip'] }],
  markdown: [{ name: 'Markdown', extensions: ['md'] }],
};

export interface ExportRequest {
  format: ExporterFormat;
  htmlContent: string;
  defaultFilename?: string;
}

export interface ExportResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

export function parseRequest(raw: unknown): ExportRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError('export expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const format = r['format'];
  const html = r['htmlContent'];
  const defaultFilename = r['defaultFilename'];
  if (
    format !== 'html' &&
    format !== 'pdf' &&
    format !== 'pptx' &&
    format !== 'zip' &&
    format !== 'markdown'
  ) {
    throw new CodesignError(`Unknown export format: ${String(format)}`, 'EXPORTER_UNKNOWN');
  }
  if (typeof html !== 'string' || html.length === 0) {
    throw new CodesignError('export requires non-empty htmlContent', 'IPC_BAD_INPUT');
  }
  const out: ExportRequest = { format, htmlContent: html };
  if (typeof defaultFilename === 'string' && defaultFilename.length > 0) {
    out.defaultFilename = defaultFilename;
  }
  return out;
}

export function registerExporterIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('codesign:export', async (_evt, raw: unknown): Promise<ExportResponse> => {
    const req = parseRequest(raw);
    const win = getWindow();
    const defaultExt = req.format === 'markdown' ? 'md' : req.format;
    const opts: Electron.SaveDialogOptions = {
      title: `Export design as ${req.format.toUpperCase()}`,
      defaultPath: req.defaultFilename ?? `design.${defaultExt}`,
      filters: FORMAT_FILTERS[req.format],
    };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) {
      return { status: 'cancelled' };
    }

    // All four formats ship in tier 1; the heavy deps load lazily inside
    // exportArtifact. Errors propagate to the renderer as toasts (PRINCIPLES §10).
    const result = await exportArtifact(req.format, req.htmlContent, picked.filePath);
    return { status: 'saved', path: result.path, bytes: result.bytes };
  });
}
