import type { StateEvent } from './state-evaluation.js';

export interface GoalMemoryInput {
  goal: string;
  events: StateEvent[];
  cutoff: number;
  byteLimit: number;
}
export const goalMemoryVersion = 'goal-archive-recall@1';
const globalScope =
  /workspace[- ]wide|global|全局|所有设计|全部设计|all designs|every design|整个工作区|across designs/iu;
const constraint = /禁止|不允许|不得|必须|禁用|forbid|never|must|disabl|requir|restrict|prohibit/iu;
const correction = /纠正|更正|修正|替代|改为|换成|instead|correct|replace|supersede/iu;
const decision =
  /保留|只|批准|决定|选择|未完成|keep|only|preserve|avoid|approve|decid|choos|pending/iu;
const observation = /read|preview|verif|test|build|check|observ|changed|读取|预览|通过|失败/iu;
const fileRef = (text: string) =>
  text.match(/[\w./-]+\.(?:tsx?|jsx?|css|html?|json|mjs|md)\b/iu)?.[0].toLowerCase();
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
function tokens(text: string) {
  const values = new Set(text.toLowerCase().match(/[a-z0-9_]+/gu) ?? []);
  for (const word of text.match(/[\u3400-\u9fff]+/gu) ?? []) {
    values.add(word);
    for (let i = 0; i < word.length - 1; i++) values.add(word.slice(i, i + 2));
  }
  return values;
}

/** Archive access is explicit; only public goal and prefix enter selection. */
export function selectGoalMemory(input: GoalMemoryInput) {
  const started = performance.now();
  if (
    !input ||
    typeof input.goal !== 'string' ||
    !input.goal.trim() ||
    !Array.isArray(input.events) ||
    !Number.isSafeInteger(input.cutoff) ||
    input.cutoff < 0 ||
    !Number.isSafeInteger(input.byteLimit) ||
    input.byteLimit <= 0
  )
    throw new Error('Invalid goal memory parameters');
  const { goal, cutoff, byteLimit } = input;
  const prefix: StateEvent[] = [];
  const ids = new Set<string>();
  let previous = -1;
  for (const event of input.events) {
    if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0)
      throw new Error('Invalid event sequence');
    if (event.seq > cutoff) continue;
    if (
      typeof event.id !== 'string' ||
      !event.id ||
      ids.has(event.id) ||
      event.seq <= previous ||
      typeof event.text !== 'string' ||
      typeof event.designId !== 'string' ||
      !event.designId ||
      !['user', 'tool'].includes(event.authority) ||
      (event.revision !== null && typeof event.revision !== 'string')
    )
      throw new Error('Invalid prefix evidence');
    previous = event.seq;
    ids.add(event.id);
    prefix.push(event);
  }
  const serialize = (events: StateEvent[]) => JSON.stringify({ goal, events });
  if (bytes(serialize([])) > byteLimit)
    throw new Error('Byte limit cannot hold the empty envelope');
  const activeDesignId =
    [...prefix].reverse().find((e) => e.authority === 'user')?.designId ?? null;
  const result = (selected: StateEvent[], allEventsFit: boolean) => {
    const frozenMemory = serialize(selected);
    const selectedEventIds = selected.map((e) => e.id);
    const chosen = new Set(selectedEventIds);
    return {
      frozenMemory,
      selectedEventIds,
      scannedEventIds: prefix.map((e) => e.id),
      memoryBytes: bytes(frozenMemory),
      allEventsFit,
      activeDesignId,
      archiveAccess: true as const,
      elapsedMs: performance.now() - started,
      omittedEventIds: prefix.filter((e) => !chosen.has(e.id)).map((e) => e.id),
    };
  };
  if (bytes(serialize(prefix)) <= byteLimit) return result(prefix, true);
  const isGlobal = (e: StateEvent) =>
    e.authority === 'user' && globalScope.test(e.text) && constraint.test(e.text);
  const candidates = prefix.filter(
    (e) => activeDesignId === null || e.designId === activeDesignId || isGlobal(e),
  );
  const parents = candidates.map((_, i) => i);
  const root = (index: number): number => {
    const parent = parents[index];
    if (parent === undefined) throw new Error('Missing bundle index');
    if (parent !== index) parents[index] = root(parent);
    return parents[index] ?? index;
  };
  const union = (a: number, b: number) => {
    parents[root(a)] = root(b);
  };
  const receipts = new Map<string, number>();
  candidates.forEach((event, i) => {
    if (event.authority === 'user' && correction.test(event.text)) {
      for (let j = i - 1; j >= 0; j--) {
        const prior = candidates[j];
        if (prior?.authority === 'user' && prior.designId === event.designId && !isGlobal(prior)) {
          union(i, j);
          break;
        }
      }
    }
    const file = fileRef(event.text);
    if (
      event.authority === 'tool' &&
      event.revision !== null &&
      file &&
      observation.test(event.text)
    ) {
      const key = `${event.designId}/${file}`;
      const prior = receipts.get(key);
      if (prior !== undefined) union(i, prior);
      receipts.set(key, i);
    }
  });
  const goalTokens = tokens(goal);
  const latestUser = [...prefix].reverse().find((e) => e.authority === 'user');
  const priority = (event: StateEvent) => {
    const vocabulary = tokens(event.text);
    const overlap = [...goalTokens].filter((token) => vocabulary.has(token)).length;
    return (
      (isGlobal(event) ? 1e9 : 0) +
      (event === latestUser ? 5e8 : 0) +
      (event.authority === 'user' && correction.test(event.text) ? 1e8 : 0) +
      overlap * 1e6 +
      (decision.test(event.text) ? 20000 : 0) +
      (event.authority === 'user' ? 10000 : 0) +
      (event.revision !== null && observation.test(event.text) ? 15000 : 0) +
      event.seq
    );
  };
  const bundles = new Map<number, StateEvent[]>();
  candidates.forEach((event, i) => {
    const key = root(i);
    const bundle = bundles.get(key) ?? [];
    bundle.push(event);
    bundles.set(key, bundle);
  });
  const ranked = [...bundles.values()].sort(
    (a, b) =>
      Math.max(...b.map(priority)) - Math.max(...a.map(priority)) ||
      (a[0]?.seq ?? 0) - (b[0]?.seq ?? 0),
  );
  let selected: StateEvent[] = [];
  for (const bundle of ranked) {
    const next = [...selected, ...bundle].sort((a, b) => a.seq - b.seq);
    if (bytes(serialize(next)) <= byteLimit) selected = next;
  }
  return result(selected, false);
}
