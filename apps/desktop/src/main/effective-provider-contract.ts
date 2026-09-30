import { looksLikeClaudeOAuthToken } from '@open-codesign/providers';
import {
  CHATGPT_CODEX_PROVIDER_ID,
  CodesignError,
  type Config,
  type ConnectionTestError,
  canonicalBaseUrl,
  ERROR_CODES,
  type InvokeAuthMode,
  type InvokeContractView,
  inferenceEndpointUrl,
  type ModelsProbeRelation,
  modelsEndpointUrl,
  modelsProbeRelationForProvider,
  type WireApi,
} from '@open-codesign/shared';
import { buildAuthHeadersForWire } from './auth-headers';
import {
  type ActiveModelResolution,
  type ProviderModelResolution,
  resolveActiveModel,
  resolveProviderModel,
} from './provider-settings';
import {
  type ResolveCredentialForProviderDeps,
  resolveCredentialForProvider,
} from './resolve-api-key';

export interface EffectiveProviderContract {
  providerId: string;
  modelId: string;
  wire: WireApi;
  storedBaseUrl: string;
  canonicalBaseUrl: string;
  modelsUrl: string | null;
  invokeUrl: string;
  authHeaders: Record<string, string>;
  httpHeaders: Record<string, string> | undefined;
  queryParams: Record<string, string> | undefined;
  apiKey: string;
  allowKeyless: boolean;
  builtin: boolean;
  tlsRejectUnauthorized: boolean | undefined;
  tlsBypass: boolean;
  modelsProbeRelation: ModelsProbeRelation;
  authMode: InvokeAuthMode;
  overridden: boolean;
  reasoningLevel: ActiveModelResolution['reasoningLevel'];
}

export function canonicalInvokeBaseUrl(
  stored: string | null | undefined,
  wire: WireApi,
): string | undefined {
  if (stored === undefined || stored === null || stored.length === 0) return undefined;
  return canonicalBaseUrl(stored, wire);
}

export function invokeAuthMode(wire: WireApi, apiKey: string): InvokeAuthMode {
  if (wire === 'openai-codex-responses') return 'codex-oauth';
  if (apiKey.length === 0) return 'keyless';
  if (wire === 'anthropic' && looksLikeClaudeOAuthToken(apiKey)) return 'anthropic-oauth';
  if (wire === 'anthropic') return 'x-api-key';
  return 'bearer';
}

export function toInvokeContractView(contract: EffectiveProviderContract): InvokeContractView {
  return {
    provider: contract.providerId,
    wire: contract.wire,
    canonicalBaseUrl: contract.canonicalBaseUrl,
    invokeUrl: contract.invokeUrl,
    modelsUrl: contract.modelsUrl,
    modelsProbeRelation: contract.modelsProbeRelation,
    authMode: contract.authMode,
    allowKeyless: contract.allowKeyless,
  };
}

export function buildEffectiveProviderContract(
  resolved: ProviderModelResolution,
  apiKey: string,
  overridden: boolean,
): EffectiveProviderContract {
  const storedBaseUrl = resolved.baseUrl ?? '';
  const canonical = canonicalBaseUrl(storedBaseUrl, resolved.wire);
  const modelsProbeRelation = modelsProbeRelationForProvider(resolved.wire, {
    supportsModelsEndpoint: resolved.supportsModelsEndpoint,
    modelDiscoveryMode: resolved.modelDiscoveryMode,
  });
  let modelsUrl: string | null = null;
  if (modelsProbeRelation === 'optional-discovery') {
    modelsUrl = modelsEndpointUrl(storedBaseUrl, resolved.wire);
  }
  return {
    providerId: resolved.model.provider,
    modelId: resolved.model.modelId,
    wire: resolved.wire,
    storedBaseUrl,
    canonicalBaseUrl: canonical,
    modelsUrl,
    invokeUrl: inferenceEndpointUrl(storedBaseUrl, resolved.wire),
    authHeaders: buildAuthHeadersForWire(resolved.wire, apiKey, resolved.httpHeaders, canonical),
    httpHeaders: resolved.httpHeaders,
    queryParams: resolved.queryParams,
    apiKey,
    allowKeyless: resolved.allowKeyless,
    builtin: resolved.builtin,
    tlsRejectUnauthorized: resolved.tlsRejectUnauthorized,
    tlsBypass: resolved.builtin !== true && resolved.tlsRejectUnauthorized === true,
    modelsProbeRelation,
    authMode: invokeAuthMode(resolved.wire, apiKey),
    overridden,
    reasoningLevel: resolved.reasoningLevel,
  };
}

export async function resolveEffectiveInvokeContract(input: {
  cfg: Config;
  mode: 'active' | 'provider';
  providerId?: string;
  hint?: { provider: string; modelId: string };
  creds: ResolveCredentialForProviderDeps;
}): Promise<EffectiveProviderContract> {
  const { cfg, creds } = input;
  if (input.mode === 'active') {
    const hint = input.hint ?? {
      provider: cfg.activeProvider,
      modelId: cfg.activeModel,
    };
    const active = resolveActiveModel(cfg, hint);
    const apiKey = await resolveCredentialForProvider(
      active.model.provider,
      active.allowKeyless,
      creds,
    );
    return buildEffectiveProviderContract(active, apiKey, active.overridden);
  }
  const providerId = input.providerId;
  if (providerId === undefined || providerId.length === 0) {
    throw new CodesignError(
      'test-provider expects a provider id string',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const resolved = resolveProviderModel(cfg, providerId);
  const apiKey = await resolveCredentialForProvider(providerId, resolved.allowKeyless, creds);
  return buildEffectiveProviderContract(resolved, apiKey, false);
}

export function connectionErrorFromUnknown(err: unknown): ConnectionTestError {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof CodesignError ? err.code : undefined;
  const isAuth =
    code === ERROR_CODES.PROVIDER_AUTH_MISSING ||
    code === ERROR_CODES.PROVIDER_KEY_MISSING ||
    code === ERROR_CODES.CODEX_TOKEN_NOT_LOGGED_IN;
  if (isAuth) {
    const isCodex =
      message.toLowerCase().includes('chatgpt') || message.toLowerCase().includes('codex');
    return {
      ok: false,
      code: '401',
      message,
      hint: isCodex
        ? 'ChatGPT 订阅未登录或已过期，请到 Settings 重新登录'
        : 'Open Settings and import Codex again, or add an API key for this provider',
      compatibility: 'incompatible',
      reasonCategory: 'auth',
      invokeParity: 'aligned',
    };
  }
  return {
    ok: false,
    code: 'IPC_BAD_INPUT',
    message,
    hint: 'Re-add the provider from Settings',
    compatibility: 'incompatible',
    reasonCategory: 'bad-input',
    invokeParity: 'aligned',
  };
}

/** ChatGPT Codex generate never uses a stored API-key row; it always refreshes OAuth. */
export function isCodexOAuthProvider(providerId: string, wire: WireApi): boolean {
  return providerId === CHATGPT_CODEX_PROVIDER_ID || wire === 'openai-codex-responses';
}
