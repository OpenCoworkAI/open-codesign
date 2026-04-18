import { type ArtifactEvent, createArtifactParser } from '@open-codesign/artifacts';
import { complete } from '@open-codesign/providers';
import type { Artifact, ChatMessage, ModelRef } from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import { SYSTEM_PROMPTS } from '@open-codesign/templates';

export interface GenerateInput {
  prompt: string;
  history: ChatMessage[];
  model: ModelRef;
  apiKey: string;
  baseUrl?: string;
  systemPrompt?: string;
}

export interface GenerateOutput {
  message: string;
  artifacts: Artifact[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface Collected {
  text: string;
  artifacts: Artifact[];
}

function collect(events: Iterable<ArtifactEvent>, into: Collected): void {
  for (const ev of events) {
    if (ev.type === 'text') {
      into.text += ev.delta;
    } else if (ev.type === 'artifact:end') {
      into.artifacts.push({
        id: ev.identifier || `design-${into.artifacts.length + 1}`,
        type: 'html',
        title: 'Design',
        content: ev.fullContent,
        designParams: [],
        createdAt: new Date().toISOString(),
      });
    }
  }
}

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
    { role: 'system', content: input.systemPrompt ?? SYSTEM_PROMPTS.designGenerator },
    ...input.history,
    { role: 'user', content: input.prompt },
  ];

  const result = await complete(input.model, messages, {
    apiKey: input.apiKey,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
  });

  const parser = createArtifactParser();
  const collected: Collected = { text: '', artifacts: [] };
  collect(parser.feed(result.content), collected);
  collect(parser.flush(), collected);

  return {
    message: collected.text.trim(),
    artifacts: collected.artifacts,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  };
}
