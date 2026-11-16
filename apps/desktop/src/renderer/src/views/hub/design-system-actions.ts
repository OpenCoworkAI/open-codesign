import { useCodesignStore } from '../../store';

export function groupDesignSystems<T extends { builtin: boolean }>(
  systems: T[],
): { builtin: T[]; personal: T[] } {
  return { builtin: systems.filter((s) => s.builtin), personal: systems.filter((s) => !s.builtin) };
}

export async function editLibrarySystem(id: string, prompt?: string): Promise<void> {
  const api = window.codesign?.designSystems;
  if (!api) throw new Error('Design system library unavailable');
  const design = await api.edit(id);
  const store = useCodesignStore.getState();
  await store.loadDesigns();
  await useCodesignStore.getState().switchDesign(design.id);
  useCodesignStore.getState().setView('workspace');
  if (prompt?.trim()) await useCodesignStore.getState().sendPrompt({ prompt });
}
