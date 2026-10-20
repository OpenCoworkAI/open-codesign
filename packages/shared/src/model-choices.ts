import { MINIMAX_MODEL_IDS, type ProviderEntry } from './config';

/** Ordinary choices only: never rewrite a saved activeModel or custom provider. */
export function currentModelChoices(entry: ProviderEntry, models: string[]): string[] {
  if (!entry.builtin) return models;
  if (entry.id === 'minimax') return [...MINIMAX_MODEL_IDS];
  if (entry.id !== 'openrouter') return models;
  const current = ['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3'];
  return [
    ...current.filter((id) => models.includes(id)),
    ...models.filter((id) => !/^minimax\/minimax-m/i.test(id)),
  ];
}
