/**
 * Google's OpenAI-compatible endpoint
 * (https://generativelanguage.googleapis.com/v1beta/openai/) accepts the same
 * request shape as OpenAI Chat Completions but rejects model ids carrying the
 * `models/` prefix that its own /models listing returns. Settings UI keeps the
 * prefixed id (so it matches the /models response), and we strip it only on
 * the wire. See issue #175.
 */

export function isGeminiOpenAICompat(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const { hostname } = new URL(baseUrl);
    return (
      hostname === 'generativelanguage.googleapis.com' ||
      hostname.endsWith('.generativelanguage.googleapis.com')
    );
  } catch {
    return false;
  }
}

export function normalizeGeminiModelId(modelId: string, baseUrl: string | undefined): string {
  if (!isGeminiOpenAICompat(baseUrl)) return modelId;
  return modelId.replace(/^models\//, '');
}
