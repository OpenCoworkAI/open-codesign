import {
  ModelRef,
  type ReasoningLevel,
  ReasoningLevelSchema,
  type WireApi,
  WireApiSchema,
} from '../../packages/shared/src/index';
import { exportTasks } from './datasets.mjs';

export interface ModelRunConfig {
  schemaVersion: 1;
  dataset: 'synthetic-v1' | 'design-sessions-v1';
  responseProtocol: 'legacy-v1' | 'typed-v2';
  responseFormat: 'prompt-only' | 'json-schema';
  executionGuard: 'off' | 'enforce-v1';
  model: ModelRef;
  credentialEnv: string;
  promptVariant: 'baseline' | 'constraint-check';
  trials: number;
  maxCalls: number;
  maxOutputTokens: number;
  timeoutMs: number;
  caseIds: string[];
  baseUrl?: string;
  wire?: WireApi;
  reasoning?: ReasoningLevel;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return value;
}

export function parseConfig(value: unknown): ModelRunConfig {
  if (!record(value)) throw new Error('Config must be a JSON object');
  const allowed = new Set([
    'schemaVersion',
    'dataset',
    'responseProtocol',
    'responseFormat',
    'executionGuard',
    'model',
    'credentialEnv',
    'promptVariant',
    'trials',
    'maxCalls',
    'maxOutputTokens',
    'timeoutMs',
    'caseIds',
    'baseUrl',
    'wire',
    'reasoning',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error('Unknown config field; inline credentials and headers are not supported');
  if (value['schemaVersion'] !== 1) throw new Error('Expected config schemaVersion 1');
  const model = ModelRef.safeParse(value['model']);
  if (!model.success || !model.data.provider.trim() || !model.data.modelId.trim())
    throw new Error('Specify an exact provider and nonempty modelId');
  const credentialEnv = value['credentialEnv'];
  if (typeof credentialEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(credentialEnv))
    throw new Error('credentialEnv must name an environment variable, not contain a key');
  const promptVariant = value['promptVariant'] ?? 'baseline';
  if (promptVariant !== 'baseline' && promptVariant !== 'constraint-check')
    throw new Error('Unknown prompt variant');
  const dataset = value['dataset'] ?? 'synthetic-v1';
  if (dataset !== 'synthetic-v1' && dataset !== 'design-sessions-v1')
    throw new Error('Unknown dataset');
  const available = new Set(exportTasks(dataset).tasks.map((task) => task.id));
  const responseProtocol = value['responseProtocol'] ?? 'legacy-v1';
  const responseFormat = value['responseFormat'] ?? 'prompt-only';
  const executionGuard = value['executionGuard'] ?? 'off';
  if (executionGuard !== 'off' && executionGuard !== 'enforce-v1')
    throw new Error('Unknown execution guard');
  if (executionGuard === 'enforce-v1' && dataset !== 'design-sessions-v1')
    throw new Error('Execution guard requires design-sessions-v1 host scenarios');
  if (responseProtocol !== 'legacy-v1' && responseProtocol !== 'typed-v2')
    throw new Error('Unknown response protocol');
  if (responseFormat !== 'prompt-only' && responseFormat !== 'json-schema')
    throw new Error('Unknown response format');
  if (
    responseFormat === 'json-schema' &&
    (responseProtocol !== 'typed-v2' || value['wire'] !== 'openai-chat')
  )
    throw new Error('json-schema requires typed-v2 and the openai-chat wire');
  const caseIds = value['caseIds'] ?? [...available];
  if (
    !Array.isArray(caseIds) ||
    caseIds.length === 0 ||
    caseIds.some((id: unknown) => typeof id !== 'string' || !available.has(id)) ||
    new Set(caseIds).size !== caseIds.length
  )
    throw new Error('caseIds must be distinct known fixture IDs');
  const config: ModelRunConfig = {
    schemaVersion: 1,
    dataset,
    responseProtocol,
    responseFormat,
    executionGuard,
    model: model.data,
    credentialEnv,
    promptVariant,
    trials: integer(value['trials'] ?? 1, 'trials', 100),
    maxCalls: integer(value['maxCalls'], 'maxCalls', 10_000),
    maxOutputTokens: integer(value['maxOutputTokens'] ?? 1024, 'maxOutputTokens', 32_768),
    timeoutMs: integer(value['timeoutMs'] ?? 60_000, 'timeoutMs', 300_000),
    caseIds: caseIds as string[],
  };
  if (value['baseUrl'] !== undefined) {
    let url: URL;
    try {
      url = new URL(String(value['baseUrl']));
    } catch {
      throw new Error('Invalid baseUrl');
    }
    if (
      typeof value['baseUrl'] !== 'string' ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('baseUrl must be HTTP(S), without credentials, query or fragment');
    config.baseUrl = url.href;
  }
  if (value['wire'] !== undefined) {
    const parsed = WireApiSchema.safeParse(value['wire']);
    if (!parsed.success) throw new Error('Unsupported wire API');
    config.wire = parsed.data;
  }
  if (value['reasoning'] !== undefined) {
    const parsed = ReasoningLevelSchema.safeParse(value['reasoning']);
    if (!parsed.success) throw new Error('Unsupported reasoning level');
    config.reasoning = parsed.data;
  }
  return config;
}
