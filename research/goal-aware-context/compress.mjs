export const byteLength = (text) => Buffer.byteLength(text, 'utf8');
export const serialize = (events) => JSON.stringify(events);

function fitNewest(events, budgetBytes) {
  if (!Number.isInteger(budgetBytes) || budgetBytes < 2)
    throw new Error('Budget must be an integer >= 2 UTF-8 bytes');
  const kept = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const candidate = [events[i], ...kept];
    if (byteLength(serialize(candidate)) <= budgetBytes) kept.unshift(events[i]);
  }
  return serialize(kept);
}

export function recencyPack(history, _goal, budgetBytes) {
  return fitNewest(history, budgetBytes);
}

export function goalState(history, goal, budgetBytes) {
  const latest = new Map();
  for (const entry of history) {
    if (
      entry.scope !== goal.scope ||
      !entry.accepted ||
      !['user', 'workspace'].includes(entry.source)
    )
      continue;
    latest.delete(entry.key);
    latest.set(entry.key, entry);
  }
  return fitNewest([...latest.values()], budgetBytes);
}

// A fixed rule-based reader holds retrieval behavior constant across all conditions.
export function readAnswer(context, goal, key) {
  const events = JSON.parse(context);
  if (!Array.isArray(events)) throw new Error('Context must be a JSON event array');
  let value = null;
  for (const entry of events) {
    if (
      entry?.scope === goal.scope &&
      entry.key === key &&
      entry.accepted === true &&
      ['user', 'workspace'].includes(entry.source)
    )
      value = entry.value;
  }
  return value;
}
