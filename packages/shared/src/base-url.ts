/**
 * Normalize a user-supplied provider base URL.
 *
 * Users frequently paste a full inference endpoint URL (the one printed in
 * vendor docs under "curl example") instead of the API root:
 *
 *   https://api.openai.com/v1/chat/completions
 *   https://api.anthropic.com/v1/messages
 *   https://api.openai.com/v1/responses
 *
 * Concatenating `/v1/models` onto those produces a nonsense path that many
 * OpenAI-compatible gateways black-hole (TCP accept, no response) → the
 * renderer observes a "connection timeout" with no useful diagnostic.
 *
 * Rules:
 *   1. Strip ?query and #hash — they belong to a request, not the base URL.
 *   2. Strip trailing slashes.
 *   3. Strip one trailing inference-endpoint segment if present. List is
 *      conservative — only the endpoints users actually copy from docs.
 *
 * Idempotent.
 */
const INFERENCE_ENDPOINT_SUFFIXES: readonly string[] = [
  'chat/completions',
  'completions',
  'responses',
  'messages',
  'models',
];

const ENDPOINT_SUFFIX_RE = new RegExp(
  `/(?:${[...INFERENCE_ENDPOINT_SUFFIXES]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/\//g, '\\/'))
    .join('|')})$`,
);

export function stripInferenceEndpointSuffix(baseUrl: string): string {
  let out = baseUrl.split('#')[0]?.split('?')[0] ?? '';
  out = out.replace(/\/+$/, '');
  out = out.replace(ENDPOINT_SUFFIX_RE, '');
  return out;
}

/**
 * Ensure the base URL carries an API version segment.
 *
 * OpenAI / Moonshot / OpenRouter / Kimi / Qwen use `/v1`.
 * Zhipu GLM uses `/api/paas/v4`. Volcengine/豆包 uses `/api/v3`. Google
 * AI Studio's OpenAI-compat path ends at `/v1beta/openai`.
 *
 * Hardcoding `/v1` corrupts all of the above. Rule instead:
 *   - If the path already contains any `/v<digit...>` segment, trust it.
 *   - Otherwise append `/v1` — the de-facto default for OpenAI clones.
 *
 * This matches what `pi-ai` and the OpenAI SDK do internally: they
 * concatenate the user-provided base_url with a fixed suffix like
 * `/chat/completions`, trusting the user to encode the version.
 */
export function ensureVersionedBase(baseUrl: string): string {
  const cleaned = stripInferenceEndpointSuffix(baseUrl);
  if (/\/v\d+[a-z\d]*(\/|$)/i.test(cleaned)) return cleaned;
  return `${cleaned}/v1`;
}

/** Wire values accepted by canonicalBaseUrl / modelsEndpointUrl. */
export type CanonicalWire =
  | 'anthropic'
  | 'openai-chat'
  | 'openai-responses'
  | 'openai-codex-responses';

/**
 * Canonical base URL to persist in config and hand to SDK clients (pi-ai,
 * Anthropic SDK, OpenAI SDK). One function, one answer — so "paste → test →
 * save → inference" all resolve to the same root.
 *
 *   - Anthropic wire: the Anthropic SDK appends `/v1/messages` itself, so
 *     store the root *without* /v1. `https://api.anthropic.com/v1/messages`
 *     → `https://api.anthropic.com`.
 *   - OpenAI-compat wires: the OpenAI SDK / pi-ai append `/chat/completions`,
 *     so the base_url must already carry the version segment (OpenAI /v1,
 *     Zhipu /api/paas/v4, Volcengine /api/v3, Google /v1beta/openai …). If
 *     the user didn't encode a version, default to /v1.
 *   - openai-codex-responses: pi-ai's codex wire appends `/codex/responses`
 *     from the bare base. Pass the URL through untouched — stripping or
 *     version-padding would break it.
 */
export function canonicalBaseUrl(baseUrl: string, wire: CanonicalWire): string {
  if (wire === 'openai-codex-responses') {
    // Non-regex trailing-slash trim. CodeQL flags `/\/+$/` as a polynomial
    // regex (ReDoS-adjacent on long all-slash inputs). A plain while-loop
    // is O(n) with no backtracking and makes the bound obvious to readers.
    let out = baseUrl;
    while (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  }
  const stripped = stripInferenceEndpointSuffix(baseUrl);
  if (wire === 'anthropic') return stripped.replace(/\/v1$/, '');
  return ensureVersionedBase(stripped);
}

/**
 * The URL to GET for a /models listing, given a user-supplied base URL and
 * the wire. Mirrors what each SDK's implicit /models endpoint would be.
 *
 * openai-codex-responses has no user-discoverable /models endpoint — the
 * ChatGPT subscription API requires OAuth + chatgpt-account-id headers that
 * the keyless discovery path cannot supply. Callers short-circuit via
 * ProviderEntry.modelsHint before reaching this function; if it is called,
 * we throw to surface the programming error.
 */
export function modelsEndpointUrl(baseUrl: string, wire: CanonicalWire): string {
  if (wire === 'openai-codex-responses') {
    throw new Error(
      'openai-codex-responses has no discoverable /models endpoint; use ProviderEntry.modelsHint',
    );
  }
  const base = canonicalBaseUrl(baseUrl, wire);
  // Anthropic's /models is versioned; OpenAI-compat's /models sits at the
  // already-versioned base.
  return wire === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
}
