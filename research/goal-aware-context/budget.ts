/**
 * Offline request-budget protocol for goal-aware context research.
 *
 * The budget covers the complete request that would be sent to a reader model:
 * system prompt, every context section, conversation messages, tool schemas and
 * the question. Counts are either supplied by a caller-provided tokenizer
 * (`unit: 'tokens'`), produced by the UTF-8 estimate below
 * (`unit: 'estimate'`), or explicitly unavailable. The estimate is never
 * presented as an actual token count.
 *
 * Tokenizer framing (chat templates, tool encodings, special tokens) is the
 * counter's responsibility; this module only validates and classifies results.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface CompleteModelInput {
  readonly systemPrompt: string;
  readonly contextSections: readonly string[];
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonValue;
  }[];
  readonly question: string | null;
}

export interface BudgetLimits {
  readonly inputBudgetTokens: number;
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
}

export type TokenCounterUnit = 'tokens' | 'estimate';

export interface TokenCounter {
  /** Versioned identifier, e.g. `fixture-model-framing@1`. */
  readonly id: string;
  readonly unit: TokenCounterUnit;
  count(input: CompleteModelInput): number | null;
}

export interface ProviderUsage {
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface BudgetMeasurement {
  readonly unit: 'tokens' | 'estimate' | 'unavailable';
  readonly count: number | null;
  readonly counterId: string;
  readonly overflow: boolean;
  readonly status: 'within-budget' | 'overflow' | 'unavailable';
  readonly inputLimitTokens: number;
  readonly providerUsage?: ProviderUsage;
  readonly providerOverflow?: boolean;
  readonly error?: string;
}

const unavailableCounterId = 'unavailable@1';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite JSON number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertJsonValue(child, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      // JSON.stringify drops undefined members silently; reject instead.
      if (child === undefined)
        throw new Error(`${path}.${key} must be a JSON value, not undefined`);
      assertJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} must be a plain JSON value`);
}

/** Rejects any key outside the allowed set so unsupported data cannot go uncounted. */
function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(`${path} has unsupported field(s): ${unknown.join(', ')}`);
}

function readNonEmptyStrings(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of strings`);
  return value.map((item: unknown, index: number) => {
    if (typeof item !== 'string') throw new Error(`${path}[${index}] must be a string`);
    return item;
  });
}

/**
 * Validates the request envelope. Every component is required, so a missing
 * section is rejected instead of being silently skipped from the budget.
 */
function assertCompleteModelInput(value: unknown): asserts value is CompleteModelInput {
  if (!isPlainObject(value)) throw new Error('request must be a plain object');
  const rootKeys = ['systemPrompt', 'contextSections', 'messages', 'tools', 'question'] as const;
  assertOnlyKeys(value, rootKeys, 'request');
  for (const key of rootKeys) {
    if (!(key in value)) throw new Error(`request is missing required section "${key}"`);
  }
  if (typeof value['systemPrompt'] !== 'string')
    throw new Error('request.systemPrompt must be a string');
  readNonEmptyStrings(value['contextSections'], 'request.contextSections');

  const messages = value['messages'];
  if (!Array.isArray(messages)) throw new Error('request.messages must be an array');
  messages.forEach((message: unknown, index: number) => {
    if (!isPlainObject(message))
      throw new Error(`request.messages[${index}] must be a plain object`);
    assertOnlyKeys(message, ['role', 'content'], `request.messages[${index}]`);
    if (typeof message['role'] !== 'string')
      throw new Error(`request.messages[${index}].role must be a string`);
    if (typeof message['content'] !== 'string') {
      throw new Error(`request.messages[${index}].content must be a string`);
    }
  });

  const tools = value['tools'];
  if (!Array.isArray(tools)) throw new Error('request.tools must be an array');
  tools.forEach((tool: unknown, index: number) => {
    if (!isPlainObject(tool)) throw new Error(`request.tools[${index}] must be a plain object`);
    assertOnlyKeys(tool, ['name', 'description', 'parameters'], `request.tools[${index}]`);
    if (typeof tool['name'] !== 'string')
      throw new Error(`request.tools[${index}].name must be a string`);
    if (typeof tool['description'] !== 'string') {
      throw new Error(`request.tools[${index}].description must be a string`);
    }
    if (!('parameters' in tool)) throw new Error(`request.tools[${index}].parameters is required`);
    assertJsonValue(tool['parameters'], `request.tools[${index}].parameters`);
  });

  const question = value['question'];
  if (question !== null && typeof question !== 'string') {
    throw new Error('request.question must be a string or null');
  }
}

function requireCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function readLimits(limits: unknown): BudgetLimits {
  if (!isPlainObject(limits)) throw new Error('budget limits must be a plain object');
  const inputBudgetTokens = limits['inputBudgetTokens'];
  const contextWindowTokens = limits['contextWindowTokens'];
  const reservedOutputTokens = limits['reservedOutputTokens'];

  if (typeof inputBudgetTokens !== 'number' || !Number.isSafeInteger(inputBudgetTokens)) {
    throw new Error('inputBudgetTokens limit must be a safe integer');
  }
  if (inputBudgetTokens <= 0) throw new Error('inputBudgetTokens limit must be positive');
  if (typeof contextWindowTokens !== 'number' || !Number.isSafeInteger(contextWindowTokens)) {
    throw new Error('contextWindowTokens limit must be a safe integer');
  }
  if (contextWindowTokens <= 0) throw new Error('contextWindowTokens limit must be positive');
  if (typeof reservedOutputTokens !== 'number' || !Number.isSafeInteger(reservedOutputTokens)) {
    throw new Error('reservedOutputTokens reserve must be a safe integer');
  }
  if (reservedOutputTokens < 0) throw new Error('reservedOutputTokens reserve must be >= 0');
  if (reservedOutputTokens >= contextWindowTokens) {
    throw new Error('reservedOutputTokens reserve must be below the contextWindowTokens limit');
  }
  return { inputBudgetTokens, contextWindowTokens, reservedOutputTokens };
}

function readCounter(counter: unknown): TokenCounter | null {
  if (counter === undefined || counter === null) return null;
  if (typeof counter !== 'object') throw new Error('token counter must be an object');
  const id = (counter as { id?: unknown }).id;
  const unit = (counter as { unit?: unknown }).unit;
  const count = (counter as { count?: unknown }).count;
  if (typeof id !== 'string' || id.trim() === '')
    throw new Error('counter id must be a non-empty string');
  const [name, version, ...rest] = id.split('@');
  if (
    rest.length > 0 ||
    name === undefined ||
    name.trim() === '' ||
    version === undefined ||
    version.trim() === ''
  ) {
    throw new Error(`counter id "${id}" must be "name@version" with non-empty name and version`);
  }
  if (unit !== 'tokens' && unit !== 'estimate') {
    throw new Error(`counter unit must be "tokens" or "estimate", received ${String(unit)}`);
  }
  if (typeof count !== 'function') throw new Error('counter count must be a function');
  return counter as TokenCounter;
}

function readUsage(usage: unknown): ProviderUsage | undefined {
  if (usage === undefined) return undefined;
  if (!isPlainObject(usage)) throw new Error('provider usage must be a plain object');
  const provider = usage['provider'];
  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new Error('provider usage provider must be a non-empty string');
  }
  const inputTokens = requireCount(usage['inputTokens'], 'provider usage inputTokens');
  const outputTokens = requireCount(usage['outputTokens'], 'provider usage outputTokens');
  // Detached copy: the caller may mutate their object afterwards.
  return { provider, inputTokens, outputTokens };
}

function effectiveInputLimit(limits: BudgetLimits): number {
  return Math.min(
    limits.inputBudgetTokens,
    limits.contextWindowTokens - limits.reservedOutputTokens,
  );
}

/**
 * Measures the complete request against an effective input limit of
 * `min(inputBudgetTokens, contextWindowTokens - reservedOutputTokens)`.
 *
 * Unknown, null or throwing counters yield an explicit `unavailable` result.
 * Provider usage is retained separately and never overwrites the preflight count.
 */
export function measureRequest(
  request: CompleteModelInput,
  limits: BudgetLimits,
  counter?: TokenCounter | null,
  usage?: ProviderUsage,
): BudgetMeasurement {
  assertCompleteModelInput(request);
  const validLimits = readLimits(limits);
  const inputLimitTokens = effectiveInputLimit(validLimits);
  const providerUsage = readUsage(usage);
  const activeCounter = readCounter(counter);
  const counterId = activeCounter?.id ?? unavailableCounterId;
  const base = { counterId, inputLimitTokens };
  const providerOverflow =
    providerUsage === undefined ? undefined : providerUsage.inputTokens > inputLimitTokens;
  const unavailable = (error: string): BudgetMeasurement => ({
    ...base,
    unit: 'unavailable',
    count: null,
    overflow: false,
    status: 'unavailable',
    ...(providerOverflow === undefined ? {} : { providerOverflow }),
    ...(providerUsage === undefined ? {} : { providerUsage }),
    error,
  });

  if (activeCounter === null) return unavailable('no token counter supplied');

  let raw: number | null;
  try {
    raw = activeCounter.count(request);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }

  if (raw === null) return unavailable(`counter "${activeCounter.id}" returned no count`);

  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(
      `counter "${activeCounter.id}" count must be a non-negative safe integer, received ${String(raw)}`,
    );
  }

  const overflow = raw > inputLimitTokens;
  return {
    ...base,
    unit: activeCounter.unit,
    count: raw,
    overflow,
    status: overflow ? 'overflow' : 'within-budget',
    ...(providerOverflow === undefined ? {} : { providerOverflow }),
    ...(providerUsage === undefined ? {} : { providerUsage }),
  };
}

/**
 * UTF-8 quarter-byte estimate over the serialized request. It is a cheap,
 * deterministic proxy labelled `estimate`; it is never an actual token count
 * and makes no claim about tokenizer framing.
 */
export const estimateUtf8QuarterTokens: TokenCounter = Object.freeze({
  id: 'estimate-utf8-quarter-tokens@1',
  unit: 'estimate',
  count(input: CompleteModelInput): number {
    assertCompleteModelInput(input);
    return Math.ceil(Buffer.byteLength(JSON.stringify(input), 'utf8') / 4);
  },
});

/** Fails closed: unavailable counts, input overflow and provider overflow all throw. */
export function assertWithinBudget(measurement: BudgetMeasurement): BudgetMeasurement {
  if (measurement.status === 'unavailable' || measurement.count === null) {
    const detail = measurement.error ? `: ${measurement.error}` : '';
    throw new Error(`request budget is unavailable (${measurement.counterId})${detail}`);
  }
  if (measurement.overflow) {
    throw new Error(
      `request budget overflow: ${measurement.count} > ${measurement.inputLimitTokens} tokens (${measurement.counterId})`,
    );
  }
  if (measurement.providerOverflow) {
    throw new Error(
      `provider reported input token overflow: ${measurement.providerUsage?.inputTokens ?? '?'} > ${measurement.inputLimitTokens}`,
    );
  }
  return measurement;
}
