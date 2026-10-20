import type { Config } from '@open-codesign/shared';
import { createWebResearchNetwork, type NetworkDependencies } from './web-research-network';

export function createWebResearchRun(
  config: Pick<Config, 'webSearch' | 'secrets'> | null | undefined,
  decrypt: (ciphertext: string) => string,
  deps: NetworkDependencies = {},
) {
  // Copy values now: later settings edits must not change an active run's grant or key.
  const settings = {
    enabled: config?.webSearch?.enabled ?? false,
    maxCalls: config?.webSearch?.maxCalls ?? 12,
    timeoutMs: config?.webSearch?.timeoutMs ?? 15000,
    maxChars: config?.webSearch?.maxChars ?? 10000,
  };
  const ciphertext = config?.secrets['tavily']?.ciphertext;
  let resolved = false;
  let unreadable = false;
  let apiKey: string | undefined;
  const network = createWebResearchNetwork(
    {
      ...settings,
      getApiKey: () => {
        if (!resolved) {
          resolved = true;
          try {
            apiKey = ciphertext ? decrypt(ciphertext) : undefined;
          } catch {
            unreadable = true;
          }
        }
        if (unreadable)
          throw new Error(
            'Tavily credentials could not be read. Replace the key in Settings > Web Search, then start a new turn; no app restart is needed. Never paste keys into chat.',
          );
        return apiKey;
      },
    },
    deps,
  );
  return { settings, network };
}
