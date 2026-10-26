import type { ChatMessage, ModelRef } from '@open-codesign/shared';
import type { GenerateOptions, GenerateResult } from '../../packages/providers/src/index.js';
import { hashJson } from './corpus.js';
import type { UnifiedConfig } from './unified-config.js';

export interface UnifiedCallRequest {
  id: string;
  role: 'compressor' | 'reader';
  messages: ChatMessage[];
}
export interface ReportedUsage {
  reportedInputTokens: number | null;
  reportedOutputTokens: number | null;
  reportedCostUsd: number | null;
  totalInputTokens: null;
  accounting: 'pi-wrapper; cache reads/missing-usage distinction unavailable';
}
export interface UnifiedCallResult {
  id: string;
  role: UnifiedCallRequest['role'];
  requestHash: string;
  messages: ChatMessage[];
  status:
    | 'ok'
    | 'call-limit'
    | 'duplicate-call'
    | 'busy'
    | 'stopped'
    | 'cancelled'
    | 'timeout'
    | 'length'
    | 'invalid-json'
    | 'provider-error'
    | 'missing-credential'
    | 'credential-in-request'
    | 'credential-in-response';
  value: unknown;
  raw: string | null;
  usage: ReportedUsage | null;
  elapsedMs: number;
}
export interface SessionDependencies {
  complete: (
    model: ModelRef,
    messages: ChatMessage[],
    options: GenerateOptions,
  ) => Promise<GenerateResult>;
  getCredential: (name: string) => string | undefined;
  onRequest?: (
    request: Pick<UnifiedCallRequest, 'id' | 'role' | 'messages'> & { requestHash: string },
  ) => void;
}
function usage(value: unknown): ReportedUsage | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const count = (key: string) =>
    typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= 0
      ? (v[key] as number)
      : null;
  return {
    reportedInputTokens: count('inputTokens'),
    reportedOutputTokens: count('outputTokens'),
    reportedCostUsd: count('costUsd'),
    totalInputTokens: null,
    accounting: 'pi-wrapper; cache reads/missing-usage distinction unavailable',
  };
}

/** Bounded, sequential completion boundary adapted from Sun's shared model-session pattern. */
export function createUnifiedSession(
  config: UnifiedConfig,
  deps: SessionDependencies,
  signal?: AbortSignal,
) {
  let providerCalls = 0,
    stopped = false,
    busy = false;
  const seen = new Set<string>(),
    credentials = new Map<string, string>();
  const containsSecret = (text: string) =>
    [...credentials.values()].some((key) =>
      [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)].some(
        (secret) => secret.length > 0 && text.includes(secret),
      ),
    );
  return {
    stats: () => ({ providerCalls, stopped }),
    async call(request: UnifiedCallRequest): Promise<UnifiedCallResult> {
      const start = performance.now();
      const row: UnifiedCallResult = {
        ...structuredClone(request),
        requestHash: hashJson(request.messages),
        status: 'provider-error',
        value: null,
        raw: null,
        usage: null,
        elapsedMs: 0,
      };
      if (signal?.aborted) return { ...row, status: 'cancelled' };
      if (stopped) return { ...row, status: 'stopped' };
      if (providerCalls >= config.maxCalls) return { ...row, status: 'call-limit' };
      if (seen.has(request.id)) return { ...row, status: 'duplicate-call' };
      if (busy) return { ...row, status: 'busy' };
      busy = true;
      seen.add(request.id);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      try {
        const target = config.models[request.role];
        let key = target.allowKeyless ? '' : credentials.get(target.credentialEnv);
        if (key === undefined) {
          key = deps.getCredential(target.credentialEnv)?.trim();
          if (key === undefined || (!target.allowKeyless && key.trim() === '')) {
            stopped = true;
            return { ...row, status: 'missing-credential' };
          }
          credentials.set(target.credentialEnv, key);
        }
        if (containsSecret(JSON.stringify(request.messages))) {
          stopped = true;
          return {
            ...row,
            messages: [{ role: 'user', content: '[REDACTED]' }],
            status: 'credential-in-request',
          };
        }
        if (signal?.aborted) return { ...row, status: 'cancelled' };
        const cancellation = new Promise<never>((_, reject) => {
          abortListener = () => {
            controller.abort();
            reject(new Error('cancelled'));
          };
          signal?.addEventListener('abort', abortListener, { once: true });
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
          }, config.timeoutMs);
        });
        const options: GenerateOptions = {
          apiKey: key,
          signal: controller.signal,
          timeoutMs: config.timeoutMs,
          maxTokens: config.maxOutputTokens,
          maxRetries: 0,
          allowKeyless: target.allowKeyless,
          ...(target.baseUrl === undefined ? {} : { baseUrl: target.baseUrl }),
          ...(target.wire === undefined ? {} : { wire: target.wire }),
          ...(target.reasoning === undefined ? {} : { reasoning: target.reasoning }),
        };
        deps.onRequest?.({
          id: row.id,
          role: row.role,
          messages: structuredClone(row.messages),
          requestHash: row.requestHash,
        });
        if (controller.signal.aborted) await cancellation;
        providerCalls++;
        const result = await Promise.race([
          deps.complete(target.model, structuredClone(request.messages), options),
          cancellation,
        ]);
        row.usage = usage(result);
        if (containsSecret(result.content)) {
          row.raw = '[REDACTED]';
          row.status = 'credential-in-response';
          stopped = true;
        } else {
          row.raw = result.content;
          try {
            const parsed: unknown = JSON.parse(result.content);
            if (containsSecret(JSON.stringify(parsed))) {
              row.raw = '[REDACTED]';
              row.status = 'credential-in-response';
              stopped = true;
            } else {
              row.value = parsed;
              row.status = 'ok';
            }
          } catch {
            row.status = 'invalid-json';
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'CompletionLengthError') {
          row.status = 'length';
          row.usage = usage((error as Error & { usage?: unknown }).usage);
        } else if (controller.signal.aborted) {
          row.status = signal?.aborted ? 'cancelled' : 'timeout';
          stopped = true;
        } else {
          row.status = 'provider-error';
          stopped = true;
        }
        // Error strings can contain headers/secrets; never persist them.
      } finally {
        clearTimeout(timer);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
        busy = false;
        row.elapsedMs = Math.round(performance.now() - start);
      }
      return row;
    },
  };
}
