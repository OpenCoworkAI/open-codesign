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

const SAVE_KEY_FIELDS = ['provider', 'apiKey', 'modelPrimary', 'baseUrl'] as const;
const VALIDATE_KEY_FIELDS = ['provider', 'apiKey', 'baseUrl'] as const;
const ADD_PROVIDER_FIELDS = [
  'id',
  'name',
  'wire',
  'baseUrl',
  'apiKey',
  'defaultModel',
  'httpHeaders',
  'queryParams',
  'envKey',
  'setAsActive',
] as const;
const UPDATE_PROVIDER_FIELDS = [
  'id',
  'name',
  'baseUrl',
  'defaultModel',
  'httpHeaders',
  'queryParams',
  'wire',
  'reasoningLevel',
  'apiKey',
] as const;

function assertKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CodesignError(
        `${context} contains unsupported field "${key}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
  }
}

function stringMapFromOptional(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodesignError(`${field} must be an object`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new CodesignError(`${field}.${k} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
    }
    map[k] = v;
  }
  return map;
}

function validUrl(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new CodesignError(
        `${field} must use http(s), got "${parsed.protocol}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    return trimmed;
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(`${field} "${value}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
}

function validOptionalUrl(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new CodesignError(`${field} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (value.trim().length === 0) return undefined;
  return validUrl(value, field);
}

function validRequiredUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return validUrl(value, field);
}

export function parseSaveKey(raw: unknown): SaveKeyInput {
  return parseSaveKeyPayload(raw, SAVE_KEY_FIELDS, 'save-key');
}

function parseSaveKeyPayload(
  raw: unknown,
  allowedFields: readonly string[],
  context: string,
): SaveKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('save-key expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, allowedFields, context);
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
  if (!isSupportedOnboardingProvider(providerId)) {
    throw new CodesignError(
      `Provider "${providerId}" is not supported. Use config:v1:add-provider for custom providers.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const isKeylessBuiltin = BUILTIN_PROVIDERS[providerId].requiresApiKey === false;
  if (typeof apiKey !== 'string' || (apiKey.trim().length === 0 && !isKeylessBuiltin)) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: SaveKeyInput = {
    provider: providerId,
    apiKey: apiKey.trim(),
    modelPrimary: modelPrimary.trim(),
  };
  const parsedBaseUrl = validOptionalUrl(baseUrl, 'baseUrl');
  if (parsedBaseUrl !== undefined) out.baseUrl = parsedBaseUrl;
  return out;
}

export function parseValidateKey(raw: unknown): ValidateKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('validate-key expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, VALIDATE_KEY_FIELDS, 'validate-key');
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new CodesignError('provider must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const providerId = provider.trim();
  if (!isSupportedOnboardingProvider(providerId)) {
    throw new CodesignError(
      `Provider "${providerId}" is not supported. Only anthropic, openai, openrouter, ollama.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const isKeylessBuiltin = BUILTIN_PROVIDERS[providerId].requiresApiKey === false;
  if (typeof apiKey !== 'string' || (apiKey.trim().length === 0 && !isKeylessBuiltin)) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: ValidateKeyInput = { provider: providerId, apiKey: apiKey.trim() };
  const parsedBaseUrl = validOptionalUrl(baseUrl, 'baseUrl');
  if (parsedBaseUrl !== undefined) out.baseUrl = parsedBaseUrl;
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
  return {
    ...parseSaveKeyPayload(
      raw,
      [...SAVE_KEY_FIELDS, 'schemaVersion', 'setAsActive'],
      'set-provider-and-models',
    ),
    setAsActive,
  };
}

export function parseAddProviderPayload(raw: unknown): AddCustomProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:add-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, ADD_PROVIDER_FIELDS, 'config:v1:add-provider');
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
  const parsedBaseUrl = validRequiredUrl(baseUrl, 'baseUrl');
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof defaultModel !== 'string' || defaultModel.trim().length === 0) {
    throw new CodesignError('defaultModel must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const setAsActive = r['setAsActive'];
  if (typeof setAsActive !== 'boolean') {
    throw new CodesignError('setAsActive must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: AddCustomProviderInput = {
    id: id.trim(),
    name: name.trim(),
    wire: parsedWire.data,
    baseUrl: parsedBaseUrl,
    apiKey: apiKey.trim(),
    defaultModel: defaultModel.trim(),
    setAsActive,
  };
  const headers = stringMapFromOptional(r['httpHeaders'], 'httpHeaders');
  if (headers !== undefined && Object.keys(headers).length > 0) out.httpHeaders = headers;
  const qp = stringMapFromOptional(r['queryParams'], 'queryParams');
  if (qp !== undefined && Object.keys(qp).length > 0) out.queryParams = qp;
  if (r['envKey'] !== undefined) {
    if (typeof r['envKey'] !== 'string' || r['envKey'].trim().length === 0) {
      throw new CodesignError('envKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.envKey = r['envKey'].trim();
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
  assertKnownFields(r, UPDATE_PROVIDER_FIELDS, 'config:v1:update-provider');
  const id = r['id'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: UpdateProviderInput = { id: id.trim() };
  if (r['name'] !== undefined) {
    if (typeof r['name'] !== 'string' || r['name'].trim().length === 0) {
      throw new CodesignError('name must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.name = r['name'].trim();
  }
  if (r['baseUrl'] !== undefined) {
    out.baseUrl = validRequiredUrl(r['baseUrl'], 'baseUrl');
  }
  if (r['defaultModel'] !== undefined) {
    if (typeof r['defaultModel'] !== 'string' || r['defaultModel'].trim().length === 0) {
      throw new CodesignError('defaultModel must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.defaultModel = r['defaultModel'].trim();
  }
  const headers = stringMapFromOptional(r['httpHeaders'], 'httpHeaders');
  if (headers !== undefined) out.httpHeaders = headers;
  const queryParams = stringMapFromOptional(r['queryParams'], 'queryParams');
  if (queryParams !== undefined) out.queryParams = queryParams;
  if (r['wire'] !== undefined) {
    const parsedWire = WireApiSchema.safeParse(r['wire']);
    if (!parsedWire.success) {
      throw new CodesignError(`Unsupported wire: ${String(r['wire'])}`, ERROR_CODES.IPC_BAD_INPUT);
    }
    out.wire = parsedWire.data;
  }
  if (r['reasoningLevel'] === null) {
    // Explicit null clears the override so the core default kicks in.
    out.reasoningLevel = null;
  } else if (r['reasoningLevel'] !== undefined) {
    if (typeof r['reasoningLevel'] !== 'string') {
      throw new CodesignError('reasoningLevel must be a string', ERROR_CODES.IPC_BAD_INPUT);
    }
    const parsed = ReasoningLevelSchema.safeParse(r['reasoningLevel']);
    if (!parsed.success) {
      throw new CodesignError(
        `Unsupported reasoningLevel: ${String(r['reasoningLevel'])}`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out.reasoningLevel = parsed.data;
  }
  if (r['apiKey'] !== undefined) {
    if (typeof r['apiKey'] !== 'string') {
      throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.apiKey = r['apiKey'];
  }
  return out;
}
