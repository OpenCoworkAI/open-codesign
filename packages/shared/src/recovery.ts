/** Stable provider recovery categories crossing the main/renderer boundary. */
export const RECOVERY_CATEGORIES = [
  'auth_key_invalid',
  'auth_key_expired',
  'auth_permission',
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

export function isRecoveryCategory(value: unknown): value is RecoveryCategory {
  return typeof value === 'string' && (RECOVERY_CATEGORIES as readonly string[]).includes(value);
}
