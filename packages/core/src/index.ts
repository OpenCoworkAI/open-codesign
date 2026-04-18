import { type ArtifactEvent, createArtifactParser } from '@open-codesign/artifacts';
import { type RetryReason, complete, completeWithRetry } from '@open-codesign/providers';
import type {
  Artifact,
  ChatMessage,
  ModelRef,
  SelectedElement,
  StoredDesignSystem,
} from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import { SYSTEM_PROMPTS } from '@open-codesign/templates';

export interface AttachmentContext {
  name: string;
  path: string;
  excerpt?: string | undefined;
  note?: string | undefined;
}

export interface ReferenceUrlContext {
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  excerpt?: string | undefined;
}

export interface GenerateInput {
  prompt: string;
  history: ChatMessage[];
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
  systemPrompt?: string | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
}

export interface ApplyCommentInput {
  html: string;
  comment: string;
  selection: SelectedElement;
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
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

interface ModelRunInput {
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
  messages: ChatMessage[];
}

function createHtmlArtifact(content: string, index: number): Artifact {
  return {
    id: `design-${index + 1}`,
    type: 'html',
    title: 'Design',
    content,
    designParams: [],
    createdAt: new Date().toISOString(),
  };
}

function collect(events: Iterable<ArtifactEvent>, into: Collected): void {
  for (const ev of events) {
    if (ev.type === 'text') {
      into.text += ev.delta;
    } else if (ev.type === 'artifact:end') {
      const artifact = createHtmlArtifact(ev.fullContent, into.artifacts.length);
      if (ev.identifier) artifact.id = ev.identifier;
      into.artifacts.push(artifact);
    }
  }
}

function extractHtmlDocument(source: string): string | null {
  const doctypeMatch = source.match(/<!doctype html[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0].trim();

  const htmlMatch = source.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return htmlMatch[0].trim();

  return null;
}

function extractFallbackArtifact(text: string): { artifact: Artifact | null; message: string } {
  const fencedMatches = [...text.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const block = match[1];
    const matchedText = match[0];
    if (!block || !matchedText) continue;

    const html = extractHtmlDocument(block);
    if (!html) continue;

    return {
      artifact: createHtmlArtifact(html, 0),
      message: text.replace(matchedText, '').trim(),
    };
  }

  const html = extractHtmlDocument(text);
  if (!html) return { artifact: null, message: text.trim() };

  return {
    artifact: createHtmlArtifact(html, 0),
    message: text.replace(html, '').trim(),
  };
}

function formatDesignSystem(designSystem: StoredDesignSystem): string {
  const lines = [
    '## Design system to follow',
    `Root path: ${designSystem.rootPath}`,
    `Summary: ${designSystem.summary}`,
  ];
  if (designSystem.colors.length > 0) lines.push(`Colors: ${designSystem.colors.join(', ')}`);
  if (designSystem.fonts.length > 0) lines.push(`Fonts: ${designSystem.fonts.join(', ')}`);
  if (designSystem.spacing.length > 0) lines.push(`Spacing: ${designSystem.spacing.join(', ')}`);
  if (designSystem.radius.length > 0) lines.push(`Radius: ${designSystem.radius.join(', ')}`);
  if (designSystem.shadows.length > 0) lines.push(`Shadows: ${designSystem.shadows.join(', ')}`);
  if (designSystem.sourceFiles.length > 0) {
    lines.push(`Source files: ${designSystem.sourceFiles.join(', ')}`);
  }
  return lines.join('\n');
}

function formatAttachments(attachments: AttachmentContext[]): string | null {
  if (attachments.length === 0) return null;
  const body = attachments
    .map((file, index) => {
      const lines = [`${index + 1}. ${file.name} (${file.path})`];
      if (file.note) lines.push(`Note: ${file.note}`);
      if (file.excerpt) lines.push(`Excerpt:\n${file.excerpt}`);
      return lines.join('\n');
    })
    .join('\n\n');
  return `## Attached local references\n${body}`;
}

function formatReferenceUrl(referenceUrl: ReferenceUrlContext | null | undefined): string | null {
  if (!referenceUrl) return null;
  const lines = ['## Reference URL', `URL: ${referenceUrl.url}`];
  if (referenceUrl.title) lines.push(`Title: ${referenceUrl.title}`);
  if (referenceUrl.description) lines.push(`Description: ${referenceUrl.description}`);
  if (referenceUrl.excerpt) lines.push(`Excerpt:\n${referenceUrl.excerpt}`);
  return lines.join('\n');
}

function buildContextSections(input: {
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
}): string[] {
  const sections: string[] = [];
  if (input.designSystem) sections.push(formatDesignSystem(input.designSystem));
  const attachmentSection = formatAttachments(input.attachments ?? []);
  if (attachmentSection) sections.push(attachmentSection);
  const referenceSection = formatReferenceUrl(input.referenceUrl);
  if (referenceSection) sections.push(referenceSection);
  return sections;
}

function buildPrompt(prompt: string, contextSections: string[]): string {
  if (contextSections.length === 0) return prompt.trim();
  return [
    prompt.trim(),
    'Use the following local context and references when making design decisions. Follow the design system closely when one is provided.',
    contextSections.join('\n\n'),
  ].join('\n\n');
}

function buildRevisionPrompt(input: ApplyCommentInput, contextSections: string[]): string {
  const parts = [
    'Revise the existing HTML artifact below.',
    'Keep the overall structure, copy, and layout intact unless the user request requires a broader change.',
    'Prioritize the selected element first and avoid unrelated edits.',
    `User request: ${input.comment.trim()}`,
    `Selected element tag: <${input.selection.tag}>`,
    `Selected element selector: ${input.selection.selector}`,
    `Selected element snippet:\n${input.selection.outerHTML || '(empty)'}`,
    `Current full HTML:\n${input.html}`,
  ];
  if (contextSections.length > 0) {
    parts.push(
      'You also have the following supporting context. Use it to preserve brand consistency while applying the requested change.',
    );
    parts.push(contextSections.join('\n\n'));
  }
  parts.push(
    'Return exactly one full updated HTML artifact wrapped in the required <artifact> tag. Do not use Markdown code fences. A short summary outside the artifact is enough.',
  );
  return parts.join('\n\n');
}

async function runModel(input: ModelRunInput): Promise<GenerateOutput> {
  const result = await completeWithRetry(
    input.model,
    input.messages,
    {
      apiKey: input.apiKey,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    },
    {
      ...(input.onRetry !== undefined ? { onRetry: input.onRetry } : {}),
    },
    complete,
  );

  const parser = createArtifactParser();
  const collected: Collected = { text: '', artifacts: [] };
  collect(parser.feed(result.content), collected);
  collect(parser.flush(), collected);

  if (collected.artifacts.length === 0) {
    const fallback = extractFallbackArtifact(collected.text);
    if (fallback.artifact) {
      collected.artifacts.push(fallback.artifact);
      collected.text = fallback.message;
    }
  }

  return {
    message: collected.text.trim(),
    artifacts: collected.artifacts,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  };
}

export async function generate(input: GenerateInput): Promise<GenerateOutput> {
  if (!input.prompt.trim()) {
    throw new CodesignError('Prompt cannot be empty', 'INPUT_EMPTY_PROMPT');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: input.systemPrompt ?? SYSTEM_PROMPTS.designGenerator },
    ...input.history,
    { role: 'user', content: buildPrompt(input.prompt, buildContextSections(input)) },
  ];

  return runModel({
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    signal: input.signal,
    onRetry: input.onRetry,
    messages,
  });
}

export async function applyComment(input: ApplyCommentInput): Promise<GenerateOutput> {
  if (!input.comment.trim()) {
    throw new CodesignError('Comment cannot be empty', 'INPUT_EMPTY_COMMENT');
  }
  if (!input.html.trim()) {
    throw new CodesignError('Existing HTML cannot be empty', 'INPUT_EMPTY_HTML');
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        SYSTEM_PROMPTS.designGenerator,
        'You may also be asked to revise an existing artifact. In that case, preserve the design intent and make the smallest coherent change that satisfies the request.',
      ].join('\n\n'),
    },
    { role: 'user', content: buildRevisionPrompt(input, buildContextSections(input)) },
  ];

  return runModel({
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    signal: input.signal,
    onRetry: input.onRetry,
    messages,
  });
}
