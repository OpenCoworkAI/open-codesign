/** Stable provider recovery categories crossing the main/renderer boundary. */
export const RECOVERY_CATEGORIES = [
  'auth_key_invalid',
  'auth_key_expired',
  'auth_permission',
  'region_restricted',
  'endpoint_not_found',
  'endpoint_missing_v1',
  'wire_incompatible',
  'gateway_incompatible',
  'model_not_found',
  'model_not_supported_role',
  'rate_limit',
  'billing',
  'network_unreachable',
  'network_timeout',
  'upstream_server_error',
  'request_too_large',
  'tls_error',
  'unknown',
] as const;

export type RecoveryCategory = (typeof RECOVERY_CATEGORIES)[number];

/** Only safe recovery identity crosses the durable event boundary. */
export interface ProviderFailureContext {
  recoveryCategory: RecoveryCategory;
  status?: number;
}

export function readProviderFailureContext(value: unknown): ProviderFailureContext | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isRecoveryCategory(record['recoveryCategory'])) return undefined;
  const status = record['status'];
  return {
    recoveryCategory: record['recoveryCategory'],
    ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600
      ? { status }
      : {}),
  };
}

export function isRecoveryCategory(value: unknown): value is RecoveryCategory {
  return typeof value === 'string' && (RECOVERY_CATEGORIES as readonly string[]).includes(value);
}
