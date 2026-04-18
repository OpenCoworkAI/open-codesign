/**
 * Exporter entry point. Each format lives in its own subpath export and is
 * loaded lazily so the cold-start bundle stays lean (PRINCIPLES §1).
 *
 * Tier 1 ships HTML. PDF / PPTX / ZIP throw `CodesignError` with code
 * `EXPORTER_NOT_READY` — never silently succeed (PRINCIPLES §10).
 */

import { CodesignError } from '@open-codesign/shared';

export const EXPORTER_FORMATS = ['html', 'pdf', 'pptx', 'zip'] as const;
export type ExporterFormat = (typeof EXPORTER_FORMATS)[number];

export interface ExportOptions {
  artifactId: string;
  destinationPath: string;
}

export interface ExportResult {
  bytes: number;
  path: string;
}

export function isExporterReady(format: ExporterFormat): boolean {
  return format === 'html';
}

export type { ExportHtmlOptions } from './html';

export async function exportHtml(
  htmlContent: string,
  destinationPath: string,
  opts?: import('./html').ExportHtmlOptions,
): Promise<ExportResult> {
  const mod = await import('./html');
  return mod.exportHtml(htmlContent, destinationPath, opts);
}

export async function exportArtifact(
  format: ExporterFormat,
  htmlContent: string,
  destinationPath: string,
): Promise<ExportResult> {
  if (format === 'html') {
    return exportHtml(htmlContent, destinationPath);
  }
  if (format === 'pdf') {
    const mod = await import('./pdf');
    return mod.exportPdf();
  }
  if (format === 'pptx') {
    const mod = await import('./pptx');
    return mod.exportPptx();
  }
  if (format === 'zip') {
    const mod = await import('./zip');
    return mod.exportZip();
  }
  throw new CodesignError(`Unknown exporter format: ${format as string}`, 'EXPORTER_UNKNOWN');
}
