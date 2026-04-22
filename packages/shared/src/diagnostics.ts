export type ErrorCode =
  | '401'
  | '402'
  | '403'
  | '404'
  | '429'
  | 'ECONNREFUSED'
  | 'ETIMEDOUT'
  | 'NETWORK'
  | 'CORS'
  | 'SSL'
  | 'PARSE'
  | 'IPC_BAD_INPUT'
  | string;

export interface DiagnosticFix {
  /** i18n key for the button label */
  label: string;
  /** When present, clicking "Apply fix" calls this to derive a new baseUrl */
  baseUrlTransform?: (current: string) => string;
  /** When present, open this URL in the browser instead of mutating baseUrl */
  externalUrl?: string;
}

export interface DiagnosticHypothesis {
  /** i18n key for the displayed cause sentence */
  cause: string;
  /** Primary action the user should take */
  suggestedFix?: DiagnosticFix;
}

export interface DiagnoseContext {
  provider: string;
  baseUrl: string;
  /** HTTP status code if the error came from an HTTP response */
  status?: number;
  /** Raw attempted URL, if available */
  attemptedUrl?: string;
}

const BILLING_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/settings/organization/billing',
  anthropic: 'https://console.anthropic.com/settings/billing',
  openrouter: 'https://openrouter.ai/settings/credits',
  google: 'https://aistudio.google.com/app/apikey',
  deepseek: 'https://platform.deepseek.com/usage',
};

function billingUrlFor(provider: string): string | undefined {
  return BILLING_URLS[provider.toLowerCase()];
}

/**
 * Map an ErrorCode + context to one or more DiagnosticHypothesis items.
 * The first item is the "most likely" cause; subsequent items are alternatives.
 */
export function diagnose(code: ErrorCode, ctx: DiagnoseContext): DiagnosticHypothesis[] {
  // Normalise the code — some callers pass the HTTP status as a string like "404"
  const normalised = String(code).toUpperCase();

  if (normalised === '401' || normalised === '403') {
    return [
      {
        cause: 'diagnostics.cause.keyInvalid',
        suggestedFix: { label: 'diagnostics.fix.updateKey' },
      },
    ];
  }

  if (normalised === '402') {
    const externalUrl = billingUrlFor(ctx.provider);
    return [
      {
        cause: 'diagnostics.cause.balanceEmpty',
        suggestedFix: {
          label: externalUrl ? 'diagnostics.fix.addCredits' : 'diagnostics.fix.addCreditsGeneric',
          ...(externalUrl ? { externalUrl } : {}),
        },
      },
    ];
  }

  if (normalised === '404') {
    return [
      {
        cause: 'diagnostics.cause.missingV1',
        suggestedFix: {
          label: 'diagnostics.fix.addV1',
          baseUrlTransform: (cur: string) => {
            const cleaned = cur.replace(/\/+$/, '');
            return cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`;
          },
        },
      },
    ];
  }

  if (normalised === '429') {
    return [
      {
        cause: 'diagnostics.cause.rateLimit',
        suggestedFix: { label: 'diagnostics.fix.waitAndRetry' },
      },
    ];
  }

  if (normalised === 'ECONNREFUSED' || normalised === 'ENOTFOUND') {
    return [
      {
        cause: 'diagnostics.cause.hostUnreachable',
        suggestedFix: { label: 'diagnostics.fix.checkNetwork' },
      },
    ];
  }

  if (normalised === 'ETIMEDOUT') {
    return [
      {
        cause: 'diagnostics.cause.timedOut',
        suggestedFix: { label: 'diagnostics.fix.checkVpn' },
      },
    ];
  }

  if (normalised === 'CORS') {
    return [
      {
        cause: 'diagnostics.cause.corsError',
        suggestedFix: { label: 'diagnostics.fix.reportBug' },
      },
    ];
  }

  if (normalised === 'SSL') {
    return [
      {
        cause: 'diagnostics.cause.sslError',
        suggestedFix: { label: 'diagnostics.fix.disableTls' },
      },
    ];
  }

  return [
    {
      cause: 'diagnostics.cause.unknown',
    },
  ];
}

export interface GenerateFailureContext {
  /** Active provider ID at the time of failure. */
  provider: string;
  /** Per-provider baseUrl override. Empty / undefined means "vendor default". */
  baseUrl?: string;
  /** Wire protocol the request was sent over (anthropic / openai-chat / openai-responses). */
  wire?: string;
  /** HTTP status code, if the failure came from an HTTP response. */
  status?: number;
  /** Error message — inspected for heuristic hints (e.g. "page not found", "instructions"). */
  message?: string;
}

/**
 * Map a generate-time failure to the same DiagnosticHypothesis shape the
 * connection-test path uses, so renderer toast / panel code can render
 * identical "most likely cause + suggested fix" affordances.
 *
 * Cases covered today:
 *   - 400 with "instructions" in body → openai-responses misconfigured,
 *     suggest switching wire to openai-chat
 *   - 5xx with "not implemented" / "page not found" in body → gateway
 *     does not implement the upstream Messages API, suggest switching wire
 *   - 404 → delegates to diagnose('404') for the missing-/v1 hint
 *   - 401 / 402 / 403 / 429 → delegates to diagnose(String(status))
 *   - 404-shaped message even when no status is attached (e.g. a raw
 *     "404 page not found" body surfaced as message text)
 *   - Everything else → generic unknown hypothesis
 */
export function diagnoseGenerateFailure(ctx: GenerateFailureContext): DiagnosticHypothesis[] {
  const message = (ctx.message ?? '').toLowerCase();
  const status = ctx.status;

  if (status === 400 && message.includes('instructions')) {
    return [
      {
        cause: 'diagnostics.cause.openaiResponsesMisconfigured',
        suggestedFix: { label: 'diagnostics.fix.switchWire' },
      },
    ];
  }

  if (status !== undefined && status >= 500 && status < 600) {
    if (
      message.includes('not implemented') ||
      message.includes('page not found') ||
      message.includes('404 page')
    ) {
      return [
        {
          cause: 'diagnostics.cause.gatewayIncompatible',
          suggestedFix: { label: 'diagnostics.fix.switchWire' },
        },
      ];
    }
    return [
      {
        cause: 'diagnostics.cause.serverError',
        suggestedFix: { label: 'diagnostics.fix.waitAndRetry' },
      },
    ];
  }

  if (status !== undefined) {
    return diagnose(String(status), {
      provider: ctx.provider,
      baseUrl: ctx.baseUrl ?? '',
    });
  }

  // No status attached — the Win11 gateway case surfaces as a plain
  // "404 page not found" message with no HTTP metadata. Fall back to
  // pattern-matching so #130 reaches a helpful hypothesis anyway.
  if (message.includes('404') && message.includes('page not found')) {
    return diagnose('404', {
      provider: ctx.provider,
      baseUrl: ctx.baseUrl ?? '',
    });
  }

  return [{ cause: 'diagnostics.cause.unknown' }];
}
