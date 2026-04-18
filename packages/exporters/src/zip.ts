import { CodesignError } from '@open-codesign/shared';

/**
 * Tier 2 — bundle artifact + assets + README into a portable ZIP.
 * Throws loudly so callers cannot mistake "not yet shipped" for "succeeded silently".
 */
export async function exportZip(): Promise<never> {
  throw new CodesignError('ZIP export ships in Phase 2', 'EXPORTER_NOT_READY');
}
