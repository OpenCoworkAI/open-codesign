import type { ReasoningLevel } from '@open-codesign/shared';

/** Match direct endpoints only; gateway request contracts remain independent. */
export function isDirectMiniMaxModel(modelId: string, baseUrl: string | undefined): boolean {
  if (modelId !== 'MiniMax-M3.1-Flash' && modelId !== 'MiniMax-M3') return false;
  try {
    const url = new URL(baseUrl ?? '');
    return (
      url.protocol === 'https:' && ['api.minimax.io', 'api.minimaxi.com'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Applied after pi serializes the request, without changing messages or tool history. */
export function normalizeMiniMaxPayload(
  payload: unknown,
  modelId: string,
  baseUrl: string | undefined,
  api: string,
  reasoning: ReasoningLevel | undefined,
): unknown {
  if (!isDirectMiniMaxModel(modelId, baseUrl) || typeof payload !== 'object' || payload === null) {
    return payload;
  }
  const params = payload as Record<string, unknown>;
  const flash = modelId === 'MiniMax-M3.1-Flash';
  const effort = reasoning === 'minimal' ? 'low' : reasoning === 'off' ? undefined : reasoning;
  if (flash) delete params['service_tier'];
  if (api === 'anthropic-messages') {
    // Flash is adaptive-only. M3 keeps the protocol's default (disabled).
    params['thinking'] = { type: flash || effort !== undefined ? 'adaptive' : 'disabled' };
    if (flash) params['output_config'] = { effort: effort ?? 'max' };
    else delete params['output_config'];
  } else if (api === 'openai-completions') {
    params['thinking'] = { type: !flash && reasoning === 'off' ? 'disabled' : 'adaptive' };
    if (flash) params['reasoning_effort'] = effort ?? 'max';
    else delete params['reasoning_effort'];
    delete params['reasoning_split'];
  } else if (api === 'openai-responses') {
    // The API is stateless: the full client-side input is retained verbatim.
    delete params['store'];
    delete params['previous_response_id'];
    delete params['conversation'];
    if (flash || effort !== undefined) params['reasoning'] = { effort: effort ?? 'max' };
    else delete params['reasoning'];
  }
  return params;
}
