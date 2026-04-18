import { createArtifactParser } from '@open-codesign/artifacts';
import { type RetryReason, completeWithRetry } from '@open-codesign/providers';
import type { Artifact, ChatMessage, ModelRef } from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';

export interface GenerateInput {
  prompt: string;
  history: ChatMessage[];
  model: ModelRef;
  apiKey: string;
  baseUrl?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  onRetry?: (info: RetryReason) => void;
}

export interface GenerateOutput {
  message: string;
  artifacts: Artifact[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a UI designer. When the user asks for a visual design, output a single self-contained HTML artifact wrapped in:

<artifact identifier="design-1" type="html" title="Short title">
<!doctype html>
<html>...</html>
</artifact>

Use Tailwind via the CDN script <script src="https://cdn.tailwindcss.com"></script>. Use semantic HTML, modern aesthetics (warm neutrals, generous whitespace, subtle shadows). Use CSS custom properties for tunable values (colors, spacing, font sizes) so the user can tweak them later.`;

/**
 * Generate one design artifact in response to a user prompt.
 * Tier 1: blocking call, returns the parsed artifact list at the end.
 * Tier 2 will switch to streaming with intermediate events.
 */
export async function generate(input: GenerateInput): Promise<GenerateOutput> {
  if (!input.prompt.trim()) {
    throw new CodesignError('Prompt cannot be empty', 'INPUT_EMPTY_PROMPT');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    ...input.history,
    { role: 'user', content: input.prompt },
  ];

  const result = await completeWithRetry(
    input.model,
    messages,
    {
      apiKey: input.apiKey,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    },
    {
      ...(input.onRetry !== undefined ? { onRetry: input.onRetry } : {}),
    },
  );

  const parser = createArtifactParser();
  const artifacts: Artifact[] = [];
  let textBuffer = '';

  for (const ev of parser.feed(result.content)) {
    if (ev.type === 'text') textBuffer += ev.delta;
    if (ev.type === 'artifact:end') {
      artifacts.push({
        id: ev.identifier || `design-${artifacts.length + 1}`,
        type: 'html',
        title: 'Design',
        content: ev.fullContent,
        designParams: [],
        createdAt: new Date().toISOString(),
      });
    }
  }
  for (const ev of parser.flush()) {
    if (ev.type === 'text') textBuffer += ev.delta;
    if (ev.type === 'artifact:end') {
      artifacts.push({
        id: ev.identifier || `design-${artifacts.length + 1}`,
        type: 'html',
        title: 'Design',
        content: ev.fullContent,
        designParams: [],
        createdAt: new Date().toISOString(),
      });
    }
  }

  return {
    message: textBuffer.trim(),
    artifacts,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  };
}
