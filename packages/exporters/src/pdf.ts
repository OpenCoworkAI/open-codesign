import { CodesignError } from '@open-codesign/shared';

/**
 * Tier 2 — Chromium print-to-PDF via Electron's offscreen `webContents`.
 * Throws loudly so callers cannot mistake "not yet shipped" for "succeeded silently".
 */
export async function exportPdf(): Promise<never> {
  throw new CodesignError('PDF export ships in Phase 2', 'EXPORTER_NOT_READY');
}
