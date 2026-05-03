/**
 * Exporter entry point. Each format lives in its own subpath export and is
 * loaded lazily so the cold-start bundle stays lean (PRINCIPLES §1).
 *
 * Tier 1 ships HTML, PDF, PPTX, and ZIP — all four lazy-loaded so the heavy
 * runtime deps (`puppeteer-core`, `pptxgenjs`, `zip-lib`) only enter the
 * module graph the first time a user actually exports.
 */

import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export const EXPORTER_FORMATS = ['html', 'pdf', 'pptx', 'zip', 'markdown'] as const;
export type ExporterFormat = (typeof EXPORTER_FORMATS)[number];

export interface ExportOptions {
  /** Directory used to resolve relative HTML asset references during export. */
  assetBasePath?: string | undefined;
  /** Workspace/root directory used for root-relative references and containment. */
  assetRootPath?: string | undefined;
}

export interface ExportResult {
  bytes: number;
  path: string;
}

export function isExporterReady(_format: ExporterFormat): boolean {
  return true;
}

export type { LocalAssetOptions } from './assets';
export { type ChromeDiscoveryDeps, findSystemChrome } from './chrome-discovery';
export type { ExportHtmlOptions } from './html';
export type { ExportMarkdownOptions, MarkdownMeta } from './markdown';
export { htmlToMarkdown } from './markdown';
export type { ExportPdfOptions } from './pdf';
export type { ExportPptxOptions } from './pptx';
export type { ExportZipOptions, ZipAsset } from './zip';

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
  opts: ExportOptions = {},
): Promise<ExportResult> {
  if (format === 'html') {
    return exportHtml(htmlContent, destinationPath, opts);
  }
  if (format === 'pdf') {
    const mod = await import('./pdf');
    return mod.exportPdf(htmlContent, destinationPath, opts);
  }
  if (format === 'pptx') {
    const mod = await import('./pptx');
    return mod.exportPptx(htmlContent, destinationPath, opts);
  }
  if (format === 'zip') {
    const mod = await import('./zip');
    return mod.exportZip(htmlContent, destinationPath, opts);
  }
  if (format === 'markdown') {
    const mod = await import('./markdown');
    return mod.exportMarkdown(htmlContent, destinationPath);
  }
  throw new CodesignError(
    `Unknown exporter format: ${format as string}`,
    ERROR_CODES.EXPORTER_UNKNOWN,
  );
}
