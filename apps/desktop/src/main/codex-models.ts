import { readCodexConfig } from './imports/codex-config';

export interface CodexModelOptions {
  suggestedModel: string | null;
  models: string[];
}

/** Catalog entries are suggestions, never an account entitlement check. */
export async function getCodexModelOptions(): Promise<CodexModelOptions> {
  const imported = await readCodexConfig();
  // A model configured for a custom API provider does not imply ChatGPT access.
  const usesBuiltinProvider =
    imported?.activeProvider === null ||
    (imported?.activeProvider === 'codex-openai' &&
      !imported.providers.some((provider) => provider.id === 'codex-openai'));
  const suggestedModel = usesBuiltinProvider ? (imported?.activeModel ?? null) : null;
  const { getModels } = await import('@mariozechner/pi-ai');
  return {
    suggestedModel,
    models: [
      ...new Set([
        ...(suggestedModel ? [suggestedModel] : []),
        ...getModels('openai-codex').map((model) => model.id),
      ]),
    ],
  };
}
