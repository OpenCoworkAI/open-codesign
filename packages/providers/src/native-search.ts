import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  streamSimple,
} from '@mariozechner/pi-ai';
import type { WebCitation } from '@open-codesign/shared';

export interface NativeSearchSource {
  url: string;
  title: string | null;
  excerpt: string | null;
  callId?: string;
  citations?: WebCitation[];
}
export interface NativeSearchUpdate {
  provider: 'openai' | 'anthropic';
  retrieval: 'native-tool';
  requests: number;
  maxRequests: number;
  actualSearches: number | null;
  searchCostUsd: number | null;
  sources: NativeSearchSource[];
}
export interface NativeSearchOptions {
  provider: 'openai' | 'anthropic';
  maxRequests: number;
  authorize(signal?: AbortSignal): Promise<void>;
  saveSources(sources: NativeSearchSource[]): Promise<void>;
  onUpdate?(update: NativeSearchUpdate): void;
  persistMessage?(message: AssistantMessage): void | Promise<void>;
}
type NativeStream = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function citationFor(value: RecordValue, callId?: string): WebCitation | undefined {
  if (value['type'] !== 'url_citation' && value['type'] !== 'web_search_result_location')
    return undefined;
  const result: WebCitation = { type: value['type'], ...(callId ? { callId } : {}) };
  for (const [key, rawKey, max] of [
    ['title', 'title', 500],
    ['citedText', 'cited_text', 12000],
    ['encryptedIndex', 'encrypted_index', 24000],
  ] as const) {
    const text = value[rawKey];
    if (typeof text === 'string') result[key] = text.slice(0, max);
  }
  for (const [key, rawKey] of [
    ['startIndex', 'start_index'],
    ['endIndex', 'end_index'],
  ] as const) {
    const index = value[rawKey];
    if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) result[key] = index;
  }
  return result;
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function citedText(text: string, citations: unknown[]): string {
  const inserts = citations
    .flatMap((value) => {
      const row = record(value);
      const url = publicUrl(row['url']);
      if (!url) return [];
      const title = String(row['title'] ?? row['source_title'] ?? new URL(url).hostname)
        .slice(0, 300)
        .replace(/[[\]\\\r\n]/g, ' ');
      const link = `[${title}](${url.replaceAll('(', '%28').replaceAll(')', '%29')})`;
      const end =
        typeof row['end_index'] === 'number' && row['end_index'] > 0
          ? Math.min(text.length, row['end_index'])
          : text.length;
      return [{ end, link }];
    })
    .sort((a, b) => b.end - a.end);
  let result = text;
  const seen = new Set<string>();
  for (const { end, link } of inserts) {
    if (seen.has(`${end}:${link}`)) continue;
    seen.add(`${end}:${link}`);
    result = result.slice(0, end) + link + result.slice(end);
  }
  return result;
}
function withCitations(message: AssistantMessage): AssistantMessage {
  const raw = message.nativeSearch;
  if (!raw) return message;
  const blocks =
    raw.provider === 'openai'
      ? raw.output.flatMap((item) => array(record(item)['content']))
      : raw.output;
  const texts = blocks
    .map(record)
    .filter((block) => block['type'] === 'text' || block['type'] === 'output_text');
  let index = 0;
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type !== 'text') return block;
      const source = texts[index++];
      if (!source || source['text'] !== block.text) return block;
      return {
        ...block,
        text: citedText(
          block.text,
          array(source[raw.provider === 'openai' ? 'annotations' : 'citations']),
        ),
      };
    }),
  };
}
function combine(previous: AssistantMessage | undefined, next: AssistantMessage): AssistantMessage {
  if (!previous) return next;
  const usage = { ...next.usage, cost: { ...next.usage.cost } };
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const)
    usage[key] += previous.usage[key];
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const)
    usage.cost[key] += previous.usage.cost[key];
  return {
    ...next,
    content: [...previous.content, ...next.content],
    usage,
    ...(next.nativeSearch
      ? {
          nativeSearch: {
            ...next.nativeSearch,
            output: [...(previous.nativeSearch?.output ?? []), ...next.nativeSearch.output],
          },
        }
      : {}),
  };
}

/** Hosts native tools at the pi boundary, preserving the primary model conversation. */
export function createNativeSearchStream(
  config: NativeSearchOptions,
  stream: NativeStream = streamSimple,
): NativeStream {
  let requests = 0;
  let childRequests = 0;
  const searchUsage = new Map<number, number | null>();
  const sources = new Map<string, NativeSearchSource>();
  let permissionDenied = false;
  // Core retries discard failed assistant messages. Keep only the last completed
  // pause for the exact same inference boundary so a retry resumes paid progress.
  let pendingContinuation: { boundary: string; message: AssistantMessage } | undefined;
  const notify = () =>
    config.onUpdate?.({
      provider: config.provider,
      retrieval: 'native-tool',
      requests,
      maxRequests: config.maxRequests,
      actualSearches:
        searchUsage.size > 0 && [...searchUsage.values()].every((value) => value !== null)
          ? [...searchUsage.values()].reduce<number>((sum, value) => sum + (value ?? 0), 0)
          : null,
      searchCostUsd: null,
      sources: [...sources.values()].slice(0, 100),
    });
  return (model, context, options = {}) => {
    const outputStream = createAssistantMessageEventStream();
    void (async () => {
      const boundary = JSON.stringify({
        api: model.api,
        provider: model.provider,
        model: model.id,
        systemPrompt: context.systemPrompt,
        messages: context.messages,
      });
      let previous =
        pendingContinuation?.boundary === boundary ? pendingContinuation.message : undefined;
      pendingContinuation = undefined;
      try {
        for (let continuation = 0; continuation <= 50; continuation++) {
          options.signal?.throwIfAborted();
          const usageKey = ++childRequests;
          if (previous) searchUsage.set(usageKey, null);
          const raw: unknown[] = [];
          const partialJson = new Map<number, string>();
          let paused = false;
          const save = async (items: unknown[], callId?: string) => {
            const added: NativeSearchSource[] = [];
            for (const item of items) {
              const value = record(item);
              const url = publicUrl(value['url']);
              if (!url) continue;
              const text = value['cited_text'] ?? value['content'];
              const old = sources.get(url);
              const sourceCallId = callId ?? old?.callId;
              const citation = citationFor(value, sourceCallId);
              const citations = [
                ...new Map(
                  [...(old?.citations ?? []), ...(citation ? [citation] : [])].map((item) => [
                    JSON.stringify(item),
                    item,
                  ]),
                ).values(),
              ];
              const source: NativeSearchSource = {
                url,
                title:
                  String(value['title'] ?? value['source_title'] ?? '').slice(0, 500) ||
                  old?.title ||
                  null,
                excerpt: typeof text === 'string' ? text.slice(0, 12000) : (old?.excerpt ?? null),
                ...(sourceCallId ? { callId: sourceCallId } : {}),
                ...(citations.length ? { citations } : {}),
              };
              if (old && JSON.stringify(old) === JSON.stringify(source)) continue;
              sources.set(url, source);
              added.push(source);
            }
            if (added.length) {
              await config.saveSources(added);
              notify();
            }
          };
          const nextContext: Context = previous
            ? { ...context, messages: [...context.messages, previous] }
            : context;
          const child = stream(model, nextContext, {
            ...options,
            maxRetries: 0,
            onPayload: async (payload, target) => {
              const params = record((await options.onPayload?.(payload, target)) ?? payload);
              if (/^sk-ant-oat/i.test(options.apiKey ?? ''))
                throw new Error(
                  'Native search requires an official API key; subscription OAuth is not supported.',
                );
              const tools = array(params['tools']).filter(
                (tool) => !String(record(tool)['type'] ?? '').startsWith('web_search'),
              );
              if (!permissionDenied && requests < config.maxRequests) {
                try {
                  await config.authorize(options.signal);
                } catch (error) {
                  if (
                    error instanceof Error &&
                    error.message.startsWith('Web research permission denied.')
                  )
                    permissionDenied = true;
                  else throw error;
                }
                options.signal?.throwIfAborted();
              }
              if (!permissionDenied && requests < config.maxRequests) {
                requests++;
                searchUsage.set(usageKey, null);
                if (config.provider === 'openai') {
                  const existingLimit = params['max_tool_calls'];
                  params['max_tool_calls'] =
                    typeof existingLimit === 'number' &&
                    Number.isSafeInteger(existingLimit) &&
                    existingLimit > 0
                      ? Math.min(existingLimit, 5)
                      : 5;
                }
                tools.push(
                  config.provider === 'openai'
                    ? { type: 'web_search' }
                    : { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
                );
                notify();
              }
              if (permissionDenied) {
                const notice =
                  'Web access was denied for this run. Use local or saved materials only; do not claim to have searched.';
                if (config.provider === 'openai')
                  params['instructions'] = `${String(params['instructions'] ?? '')}\n${notice}`;
                else
                  params['system'] = [
                    ...(typeof params['system'] === 'string'
                      ? [{ type: 'text', text: params['system'] }]
                      : array(params['system'])),
                    { type: 'text', text: notice },
                  ];
              }
              return {
                ...params,
                tools,
                ...(config.provider === 'openai'
                  ? {
                      include: [
                        ...new Set([...array(params['include']), 'web_search_call.action.sources']),
                      ],
                    }
                  : {}),
              };
            },
            onNativeEvent: async (event, output) => {
              await options.onNativeEvent?.(event, output);
              const e = record(event);
              if (
                config.provider === 'anthropic' &&
                e['type'] === 'message_delta' &&
                typeof record(e['delta'])['stop_reason'] === 'string'
              ) {
                const usage = record(e['usage']);
                const searches = record(usage['server_tool_use'])['web_search_requests'];
                if (
                  typeof searches === 'number' &&
                  Number.isSafeInteger(searches) &&
                  searches >= 0
                ) {
                  // message_delta is cumulative for this request, not an increment.
                  searchUsage.set(usageKey, searches);
                  notify();
                }
              }
              if (config.provider === 'openai' && e['type'] === 'response.output_item.done') {
                const item = record(e['item']);
                raw.push(structuredClone(item));
                if (item['type'] === 'web_search_call') {
                  await save(array(record(item['action'])['sources']), String(item['id']));
                  notify();
                }
                for (const block of array(item['content']))
                  await save(array(record(block)['annotations']));
              }
              if (config.provider === 'anthropic') {
                const index = typeof e['index'] === 'number' ? e['index'] : -1;
                if (e['type'] === 'content_block_start' && index >= 0) {
                  const block = structuredClone(record(e['content_block']));
                  raw[index] = block;
                  if (block['type'] === 'server_tool_use' && block['name'] === 'web_search') {
                    notify();
                  }
                  if (block['type'] === 'web_search_tool_result')
                    await save(array(block['content']), String(block['tool_use_id']));
                }
                if (e['type'] === 'content_block_delta' && index >= 0) {
                  const block = record(raw[index]);
                  const delta = record(e['delta']);
                  if (delta['type'] === 'text_delta')
                    block['text'] = String(block['text'] ?? '') + String(delta['text'] ?? '');
                  if (delta['type'] === 'thinking_delta')
                    block['thinking'] =
                      String(block['thinking'] ?? '') + String(delta['thinking'] ?? '');
                  if (delta['type'] === 'signature_delta')
                    block['signature'] =
                      String(block['signature'] ?? '') + String(delta['signature'] ?? '');
                  if (delta['type'] === 'input_json_delta')
                    partialJson.set(
                      index,
                      (partialJson.get(index) ?? '') + String(delta['partial_json'] ?? ''),
                    );
                  if (delta['type'] === 'citations_delta') {
                    block['citations'] = [
                      ...array(block['citations']),
                      structuredClone(delta['citation']),
                    ];
                    await save([delta['citation']]);
                  }
                }
                if (e['type'] === 'content_block_stop' && partialJson.has(index))
                  record(raw[index])['input'] = JSON.parse(partialJson.get(index) ?? '{}');
                if (e['type'] === 'message_delta')
                  paused = record(e['delta'])['stop_reason'] === 'pause_turn';
              }
              output.nativeSearch = {
                provider: config.provider,
                model: model.id,
                output: raw.filter(Boolean),
                paused,
              };
            },
          });
          let settled: AssistantMessage | undefined;
          for await (const event of child) {
            if (event.type === 'done') {
              settled = event.message;
              continue;
            }
            if (event.type === 'error') {
              settled = event.error;
              continue;
            }
            if (event.type === 'start' && previous) continue;
            outputStream.push({
              ...event,
              partial: combine(previous, event.partial),
              ...('contentIndex' in event
                ? { contentIndex: event.contentIndex + (previous?.content.length ?? 0) }
                : {}),
            });
          }
          if (!settled) throw new Error('Native search stream ended without a final message.');
          const result = combine(previous, settled);
          if (settled.stopReason === 'error' || settled.stopReason === 'aborted') {
            if (searchUsage.has(usageKey)) searchUsage.set(usageKey, null);
            notify();
            if (previous && !options.signal?.aborted)
              pendingContinuation = { boundary, message: previous };
            outputStream.push({ type: 'error', reason: settled.stopReason, error: result });
            outputStream.end();
            return;
          }
          if (paused) {
            await config.persistMessage?.(result);
            previous = result;
            continue;
          }
          const final = withCitations(result);
          await config.persistMessage?.(final);
          outputStream.push({
            type: 'done',
            reason: final.stopReason as 'stop' | 'length' | 'toolUse',
            message: final,
          });
          outputStream.end();
          return;
        }
        throw new Error('Native search continuation limit exceeded.');
      } catch (error) {
        if (previous && !options.signal?.aborted)
          pendingContinuation = { boundary, message: previous };
        const reason = options.signal?.aborted ? 'aborted' : 'error';
        const message: AssistantMessage = {
          role: 'assistant',
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: previous?.content ?? [],
          timestamp: Date.now(),
          stopReason: reason,
          errorMessage: error instanceof Error ? error.message : 'Native search failed.',
          usage: previous?.usage ?? {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
        outputStream.push({ type: 'error', reason, error: message });
        outputStream.end();
      }
    })();
    return outputStream;
  };
}
