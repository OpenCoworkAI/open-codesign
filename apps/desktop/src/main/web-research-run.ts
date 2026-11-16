import { type Config, hydrateConfig, resolveWebSearchRoute } from '@open-codesign/shared';
import { resolveActiveApiKey } from './resolve-api-key';
import { createWebResearchNetwork, type NetworkDependencies } from './web-research-network';

export function createWebResearchRun(
  config:
    | (Pick<Config, 'webSearch' | 'secrets'> &
        Partial<Pick<Config, 'activeProvider' | 'activeModel' | 'providers'>>)
    | null
    | undefined,
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
  const route = resolveWebSearchRoute(
    hydrateConfig({
      version: 3,
      activeProvider: config?.activeProvider ?? '',
      activeModel: config?.activeModel ?? '',
      providers: config?.providers ?? {},
      secrets: config?.secrets ?? {},
      ...(config?.webSearch ? { webSearch: config.webSearch } : {}),
    }),
  );
  const credentialId = route.providerId ?? 'tavily';
  const ciphertext = config?.secrets[credentialId]?.ciphertext;
  let credential: Promise<string | undefined> | undefined;
  const network = createWebResearchNetwork(
    {
      ...settings,
      service: route.service,
      getApiKey: () => {
        credential ??= (async () => {
          try {
            return ciphertext
              ? await resolveActiveApiKey(credentialId, {
                  getApiKeyForProvider: () => decrypt(ciphertext),
                  getCodexAccessToken: async () => {
                    throw new Error('Subscription credentials cannot be used for web search.');
                  },
                })
              : undefined;
          } catch {
            throw new Error(
              route.service === 'tavily'
                ? 'Tavily credentials could not be read. Replace the key in Settings > Web Search, then start a new turn; no app restart is needed. Never paste keys into chat.'
                : 'Search credentials could not be read. Check Settings > Web Search, then start a new turn; no app restart is needed. Never paste keys into chat.',
            );
          }
        })();
        return credential;
      },
    },
    deps,
  );
  return {
    settings,
    network,
    route,
    maxNativeRequests: config?.webSearch?.maxNativeRequests ?? 12,
  };
}
