import { SourceEntryResultV1 } from '@open-codesign/shared';
import type { CodesignState } from '../../store';
import { recordPreviewSourceInPool } from './snapshots';

type SetState = (
  updater: Partial<CodesignState> | ((state: CodesignState) => Partial<CodesignState>),
) => void;

export function makeSourcesSlice(
  set: SetState,
  get: () => CodesignState,
): Pick<CodesignState, 'refreshSourceEntry' | 'selectDesignSource'> {
  const requests = new Map<string, number>();
  async function adopt(designId: string, request: number, result: unknown) {
    const entry = SourceEntryResultV1.parse(result);
    if (entry.designId !== designId) throw new Error('The source entry belongs to another design.');
    if (requests.get(designId) !== request) return get().sourceEntryByDesign[designId] ?? null;
    set((state) => {
      const identities = { ...state.previewIdentityByDesign };
      if (entry.status === 'ready' || entry.status === 'planned')
        identities[designId] = entry.source;
      else delete identities[designId];
      const blocked = entry.status === 'invalid' || entry.status === 'needs-selection';
      const content = entry.status === 'ready' || entry.status === 'planned' ? entry.content : null;
      const pool = recordPreviewSourceInPool(
        state.previewSourceByDesign,
        state.recentDesignIds,
        designId,
        content?.trim() ? content : null,
      );
      if (!content?.trim()) delete pool.cache[designId];
      return {
        sourceEntryByDesign: { ...state.sourceEntryByDesign, [designId]: entry },
        previewIdentityByDesign: identities,
        previewSourceByDesign: pool.cache,
        recentDesignIds: pool.recent,
        ...(state.currentDesignId === designId
          ? { previewSource: content?.trim() ? content : null }
          : {}),
        ...(blocked && state.currentDesignId === designId
          ? { previewSource: null, selectedElement: null, commentBubble: null }
          : {}),
      };
    });
    return entry;
  }
  return {
    async refreshSourceEntry(designId) {
      const api = window.codesign?.sourceEntry;
      if (!api) return null;
      const request = (requests.get(designId) ?? 0) + 1;
      requests.set(designId, request);
      return adopt(designId, request, await api.get(designId));
    },
    async selectDesignSource(designId, path) {
      const api = window.codesign?.sourceEntry;
      const entry = get().sourceEntryByDesign[designId];
      if (!api || !entry?.workspacePath)
        throw new Error('Reload the design source before choosing a file.');
      const request = (requests.get(designId) ?? 0) + 1;
      requests.set(designId, request);
      try {
        const selected = await adopt(
          designId,
          request,
          await api.select({
            schemaVersion: 1,
            designId,
            path,
            expectedWorkspacePath: entry.workspacePath,
            expectedRevision: entry.revision,
          }),
        );
        if (selected?.status === 'ready')
          get().setPreviewSourceFromAgent({
            designId,
            content: selected.content,
            source: selected.source,
          });
      } catch (error) {
        await get().refreshSourceEntry(designId);
        throw error;
      }
    },
  };
}
