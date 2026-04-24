import {
  BUILTIN_PROVIDERS,
  CodesignError,
  ERROR_CODES,
  isSupportedOnboardingProvider,
  type ReasoningLevel,
  ReasoningLevelSchema,
  type SupportedOnboardingProvider,
  type WireApi,
  WireApiSchema,
} from '@open-codesign/shared';

export interface SaveKeyInput {
  provider: string;
  apiKey: string;
  modelPrimary: string;
  baseUrl?: string;
}

export interface ValidateKeyInput {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  baseUrl?: string;
}

export interface SetProviderAndModelsInput extends SaveKeyInput {
  setAsActive: boolean;
}

export interface AddCustomProviderInput {
  id: string;
  name: string;
  wire: WireApi;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  envKey?: string;
  setAsActive: boolean;
}

export interface UpdateProviderInput {
  id: string;
  name?: string;
  baseUrl?: string;
  defaultModel?: string;
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  wire?: WireApi;
  reasoningLevel?: ReasoningLevel | null;
  /** When present AND non-empty, re-encrypt and replace the stored secret.
   *  Empty string means "clear stored secret" for providers that became
   *  keyless (e.g. switched to local Ollama). `undefined` means "leave alone". */
  apiKey?: string;
}

export function parseSaveKey(raw: unknown): SaveKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('save-key expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const modelPrimary = r['modelPrimary'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new CodesignError(
      `Provider "${String(provider)}" is invalid.`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const providerId = provider.trim();
  const isKeylessBuiltin =
    isSupportedOnboardingProvider(providerId) &&
    BUILTIN_PROVIDERS[providerId].requiresApiKey === false;
  if (typeof apiKey !== 'string' || (apiKey.trim().length === 0 && !isKeylessBuiltin)) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: SaveKeyInput = { provider: providerId, apiKey: apiKey.trim(), modelPrimary };
  if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
    try {
      new URL(baseUrl);
    } catch {
      throw new CodesignError(`baseUrl "${baseUrl}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
    }
    out.baseUrl = baseUrl.trim();
  }
  return out;
}

export function parseValidateKey(raw: unknown): ValidateKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('validate-key expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string') {
    throw new CodesignError('provider must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (!isSupportedOnboardingProvider(provider)) {
    throw new CodesignError(
      `Provider "${provider}" is not supported in v0.1. Only anthropic, openai, openrouter.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const out: ValidateKeyInput = { provider, apiKey };
  if (typeof baseUrl === 'string' && baseUrl.length > 0) out.baseUrl = baseUrl;
  return out;
}

export function parseSetProviderAndModels(raw: unknown): SetProviderAndModelsInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'set-provider-and-models expects an object payload',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  const sv = r['schemaVersion'];
  if (sv !== undefined && sv !== 1) {
    throw new CodesignError(
      `Unsupported schemaVersion ${String(sv)} (expected 1)`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const setAsActive = r['setAsActive'];
  if (typeof setAsActive !== 'boolean') {
    throw new CodesignError('setAsActive must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
  }
  return { ...parseSaveKey(raw), setAsActive };
}

export function parseAddProviderPayload(raw: unknown): AddCustomProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:add-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const name = r['name'];
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  const defaultModel = r['defaultModel'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new CodesignError('name must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const parsedWire = WireApiSchema.safeParse(wire);
  if (!parsedWire.success) {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new CodesignError(`baseUrl "${baseUrl}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof defaultModel !== 'string' || defaultModel.trim().length === 0) {
    throw new CodesignError('defaultModel must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const setAsActive = r['setAsActive'];
  const out: AddCustomProviderInput = {
    id: id.trim(),
    name: name.trim(),
    wire: parsedWire.data,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    defaultModel: defaultModel.trim(),
    setAsActive: setAsActive === true,
  };
  const headers = r['httpHeaders'];
  if (headers !== undefined && headers !== null && typeof headers === 'object') {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    if (Object.keys(map).length > 0) out.httpHeaders = map;
  }
  const qp = r['queryParams'];
  if (qp !== undefined && qp !== null && typeof qp === 'object') {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(qp as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    if (Object.keys(map).length > 0) out.queryParams = map;
  }
  if (typeof r['envKey'] === 'string' && (r['envKey'] as string).length > 0) {
    out.envKey = r['envKey'] as string;
  }
  return out;
}

export function parseUpdateProviderPayload(raw: unknown): UpdateProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'config:v1:update-provider expects an object',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: UpdateProviderInput = { id };
  if (typeof r['name'] === 'string') out.name = r['name'] as string;
  if (typeof r['baseUrl'] === 'string') out.baseUrl = r['baseUrl'] as string;
  if (typeof r['defaultModel'] === 'string') out.defaultModel = r['defaultModel'] as string;
  if (
    r['httpHeaders'] !== undefined &&
    typeof r['httpHeaders'] === 'object' &&
    r['httpHeaders'] !== null
  ) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r['httpHeaders'] as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    out.httpHeaders = map;
  }
  if (
    r['queryParams'] !== undefined &&
    typeof r['queryParams'] === 'object' &&
    r['queryParams'] !== null
  ) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r['queryParams'] as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    out.queryParams = map;
  }
  if (typeof r['wire'] === 'string') {
    const parsedWire = WireApiSchema.safeParse(r['wire']);
    if (parsedWire.success) out.wire = parsedWire.data;
  }
  if (r['reasoningLevel'] === null) {
    // Explicit null clears the override so the core default kicks in.
    out.reasoningLevel = null;
  } else if (typeof r['reasoningLevel'] === 'string') {
    const parsed = ReasoningLevelSchema.safeParse(r['reasoningLevel']);
    if (parsed.success) out.reasoningLevel = parsed.data;
  }
  if (typeof r['apiKey'] === 'string') out.apiKey = r['apiKey'];
  return out;
}
