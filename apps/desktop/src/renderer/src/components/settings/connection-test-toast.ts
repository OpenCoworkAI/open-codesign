import type { ConnectionTestResponse } from '@open-codesign/shared';

export type ConnectionTestToastKind = 'ok' | 'degraded' | 'diverges' | 'failed';

/** Map the structured connection-test payload onto Settings toast variants. */
export function connectionTestToastKind(res: ConnectionTestResponse): ConnectionTestToastKind {
  if (res.ok && res.compatibility === 'degraded') return 'degraded';
  if (!res.ok && res.compatibility === 'diverges') return 'diverges';
  if (res.ok) return 'ok';
  return 'failed';
}
