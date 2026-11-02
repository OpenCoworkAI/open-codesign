export const uiLeaseDirectory: string;
export function acquireUiLease(
  role: 'suite' | 'session',
  directory?: string,
  env?: NodeJS.ProcessEnv,
): { env: NodeJS.ProcessEnv; release(): void };
