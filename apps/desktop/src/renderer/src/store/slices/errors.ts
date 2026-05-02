import type { DiagnosticHypothesis, OnboardingState } from '@open-codesign/shared';
import { diagnoseGenerateFailure } from '@open-codesign/shared';
import { tr } from '../lib/locale.js';

export type ToastVariant = 'success' | 'error' | 'info';

/** Cap on the in-memory ReportableError ring. Dropping the oldest entries keeps
 *  the store bounded during long sessions while still covering every recent
 *  user-visible error — the Report dialog only needs whatever is on-screen. */
export const MAX_REPORTABLE = 100;

/**
 * Input to `createReportableError`. Mirrors ReportableError minus the fields
 * the store fills in synchronously (`localId`, `ts`, `fingerprint`,
 * `persistedEventId`, `persistedFingerprint`).
 */
export interface CreateReportableErrorInput {
  code: string;
  scope: string;
  message: string;
  stack?: string;
  runId?: string;
  context?: Record<string, unknown>;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  /**
   * Pointer into `reportableErrors` for the Report button. Set when a
   * ReportableError was constructed alongside this toast (every error toast
   * should have one — see `createReportableError`). Missing for info/success
   * toasts that don't need a Report affordance.
   */
  localId?: string;
  /**
   * Optional secondary action rendered as a button inside the toast. Used
   * to turn diagnostic toasts into actionable ones — e.g. a "no API key"
   * generate error becomes a toast with "Open Settings" that jumps the
   * user to the fix. `onClick` is called before the toast is dismissed.
   */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Input to `reportableErrorToast`. Mirrors `Toast` minus the auto-filled
 * fields (id, variant, localId) plus the ReportableError triage fields
 * the store uses to build a richer record than pushToast's auto-wrap.
 */
export interface ReportableErrorToastSpec {
  title: string;
  description?: string;
  action?: Toast['action'];
  code: string;
  scope: string;
  stack?: string;
  runId?: string;
  context?: Record<string, unknown>;
  /**
   * When false, the toast is shown without recording a ReportableError,
   * so the Toast UI does NOT render the "Report" button. Use this for
   * expected user-facing errors (missing config files, declined imports)
   * where prompting the user to file a bug report would just be noise.
   */
  reportable?: boolean;
}

/**
 * Read a `code` string off a CodesignError-shaped value crossing IPC. Structured-
 * clone strips the prototype but preserves own enumerable properties in Electron
 * 28+; we read defensively. Returns undefined for anything that doesn't carry a
 * non-empty string code so callers can fall back to their scope-specific default.
 */
export function extractCodesignErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) return code;
  return undefined;
}

/**
 * Pull NormalizedProviderError-shaped upstream fields off a caught error so the
 * Report dialog's "Upstream context" block can render them. Returns undefined
 * when none of the expected keys are present — callers then omit `context`
 * rather than attaching an empty object.
 */
export function extractUpstreamContext(err: unknown): Record<string, unknown> | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const rec = err as Record<string, unknown>;
  const keys = [
    'upstream_provider',
    'upstream_status',
    'upstream_code',
    'upstream_message',
    'upstream_request_id',
    'upstream_baseurl',
    'upstream_wire',
    'upstream_model_id',
    'retry_count',
    'redacted_body_head',
    'original_error_name',
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = rec[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Pull an HTTP status code off a caught generate error. Looks at the
 * `upstream_status` field main/index.ts attaches first, then falls back to
 * common SDK locations, and finally regex-scans `err.message` for the
 * #130-style "404 page not found" text that arrives with no structured status.
 */
export function extractGenerateStatus(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const rec = err as Record<string, unknown>;
  const candidates: unknown[] = [
    rec['upstream_status'],
    rec['status'],
    rec['statusCode'],
    (rec['response'] as { status?: unknown } | undefined)?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 100 && c < 600) return c;
  }
  if (err instanceof Error) {
    const m = /\b([45]\d{2})\b/.exec(err.message);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

/**
 * Pick an upstream-* string field off an err, guarding the "wrong type"
 * and "empty string" cases so callers can use `?? fallback`.
 */
export function pickUpstreamString(err: unknown, key: string): string | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const v = (err as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function deriveGenerateHypothesis(
  err: unknown,
  cfg: OnboardingState | null,
): DiagnosticHypothesis | undefined {
  const provider = pickUpstreamString(err, 'upstream_provider') ?? cfg?.provider ?? 'unknown';
  const baseUrl = pickUpstreamString(err, 'upstream_baseurl') ?? cfg?.baseUrl ?? undefined;
  const wire = pickUpstreamString(err, 'upstream_wire');
  const modelId = pickUpstreamString(err, 'upstream_model_id') ?? cfg?.modelPrimary ?? undefined;
  const code = extractCodesignErrorCode(err);
  const status = extractGenerateStatus(err);
  const message = err instanceof Error ? err.message : undefined;
  const ctx = {
    provider,
    ...(baseUrl !== undefined && baseUrl !== null ? { baseUrl } : {}),
    ...(wire !== undefined ? { wire } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(message !== undefined ? { message } : {}),
  };
  const hypotheses = diagnoseGenerateFailure(ctx);
  const primary = hypotheses[0];
  // Skip the bare "unknown" hypothesis — appending "Unknown error" to a
  // toast that already shows the upstream message is just noise.
  if (primary === undefined || primary.cause === 'diagnostics.cause.unknown') {
    return undefined;
  }
  return primary;
}

export function cleanGenerateErrorMessage(originalMessage: string): string {
  return originalMessage.replace(
    /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/,
    '',
  );
}

export function buildGenerateErrorDescription(
  originalMessage: string,
  hypothesis: DiagnosticHypothesis | undefined,
): string {
  if (hypothesis === undefined) return originalMessage;
  const hint = tr(hypothesis.cause);
  // When the i18n key was missing, tr() falls back to returning the key
  // itself; don't double up "diagnostics.cause.x" in the toast.
  if (hint === hypothesis.cause) return originalMessage;
  return `${originalMessage}\n\n${tr('diagnostics.mostLikelyCause')} ${hint}`;
}
