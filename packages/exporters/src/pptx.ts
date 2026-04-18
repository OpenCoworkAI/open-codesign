import { CodesignError } from '@open-codesign/shared';

/**
 * Tier 2 — wired through `dom-to-pptx` once research/04 is implemented.
 * Throws loudly so callers cannot mistake "not yet shipped" for "succeeded silently".
 */
export async function exportPptx(): Promise<never> {
  throw new CodesignError('PPTX export ships in Phase 2', 'EXPORTER_NOT_READY');
}
