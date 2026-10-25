import { responseContract } from './fixtures.mjs';

export interface Decision {
  action: 'edit' | 'inspect' | 'ask' | 'report-blocked' | 'done';
  status: 'pending' | 'blocked' | 'completed';
  targetIds: string[];
  changes: { field: string; value: string }[];
  expectedSourceHash: string | null;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function validDecision(value: unknown): value is Decision {
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !== Object.keys(responseContract).sort().join(',')
  )
    return false;
  return (
    typeof value['action'] === 'string' &&
    responseContract.action.includes(value['action']) &&
    typeof value['status'] === 'string' &&
    responseContract.status.includes(value['status']) &&
    Array.isArray(value['targetIds']) &&
    value['targetIds'].every((id: unknown) => typeof id === 'string') &&
    Array.isArray(value['changes']) &&
    value['changes'].every(
      (change: unknown) =>
        record(change) &&
        Object.keys(change).sort().join(',') === 'field,value' &&
        typeof change['field'] === 'string' &&
        typeof change['value'] === 'string',
    ) &&
    (value['expectedSourceHash'] === null ||
      (typeof value['expectedSourceHash'] === 'string' &&
        /^[a-f0-9]{64}$/.test(value['expectedSourceHash'])))
  );
}
