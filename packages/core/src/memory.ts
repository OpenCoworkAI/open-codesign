/**
 * Memory system for Open CoDesign.
 *
 * Boundary:
 * - Global user memory records long-running design taste and workflow habits.
 * - Workspace MEMORY.md records the current project's state and decisions.
 * - DESIGN.md remains the authoritative design-system artifact.
 * - DesignSessionBrief is a compact JSONL cache derived from these sources.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { completeWithRetry } from '@open-codesign/providers';
import type { ChatMessage, ModelRef, ReasoningLevel, WireApi } from '@open-codesign/shared';
import { remapProviderError } from './errors.js';
import { escapeUntrustedXml, formatUntrustedContext } from './lib/context-format.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';

const MEMORY_SERIALIZE_LIMIT = 100_000;
const MEMORY_MAX_OUTPUT_TOKENS = 2_000;

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      parts.push(b['text']);
    } else if (b['type'] === 'toolCall') {
      const name = typeof b['name'] === 'string' ? b['name'] : 'unknown';
      parts.push(`[tool_call: ${name}]`);
    }
  }
  return parts.join('\n');
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
export function serializeMessagesForMemory(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role;
    if (role === 'user' || role === 'assistant') {
      const text = extractTextFromContent((msg as { content?: unknown }).content);
      if (text.length > 0) lines.push(`[${role}]\n${text}`);
    } else if (role === 'toolResult') {
      const text = extractTextFromContent((msg as { content?: unknown }).content);
      if (text.length > 0) {
        const truncated = text.length > 500 ? `${text.slice(0, 500)}…[truncated]` : text;
        lines.push(`[tool_result]\n${truncated}`);
      }
    }
  }

  const full = lines.join('\n\n');
  if (full.length <= MEMORY_SERIALIZE_LIMIT) return full;

  let total = 0;
  let startIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = (lines[i]?.length ?? 0) + 2;
    if (total + len > MEMORY_SERIALIZE_LIMIT) break;
    total += len;
    startIdx = i;
  }
  const kept = lines.slice(startIdx);
  return `[…earlier messages truncated…]\n\n${kept.join('\n\n')}`;
}

export const WORKSPACE_MEMORY_SYSTEM_PROMPT = [
  'You maintain a user-readable workspace MEMORY.md file for one design project.',
  'Output ONLY the memory file content in the specified format. No preamble.',
  '',
  'Format:',
  '---',
  'schemaVersion: 1',
  'scope: workspace',
  'updatedAt: "<ISO timestamp>"',
  'workspaceName: "<name>"',
  '---',
  '',
  '# Project Memory',
  '',
  '## Project Overview',
  '- What this workspace is for.',
  '',
  '## Current State',
  '- What exists now and what condition it is in.',
  '',
  '## Artifacts',
  '- Important source/export files and what each represents.',
  '',
  '## Design Direction',
  '- High-level direction, not raw token tables.',
  '',
  '## User Feedback',
  '- Project-specific feedback and preferences.',
  '',
  '## Decisions',
  '- Stable product/design decisions already made.',
  '',
  '## Open Questions',
  '- Unresolved choices.',
  '',
  '## Next Steps',
  '- Concrete follow-up work.',
  '',
  '## Promotion Candidates For DESIGN.md',
  '- Stable visual/system decisions that should become DESIGN.md data.',
  '',
  '## Recent History',
  '- Short dated history of meaningful iterations.',
  '',
  'Rules:',
  '- Keep total file under 5000 characters.',
  '- Preserve durable facts from the existing MEMORY.md and user edits.',
  '- Do NOT copy full color, typography, spacing, or component token tables from DESIGN.md.',
  '- Do NOT copy large source code, full tool outputs, API keys, or secrets.',
  '- Treat DESIGN.md as the only authoritative design-system artifact.',
  '- Use Promotion Candidates For DESIGN.md for stable visual decisions that should be promoted.',
  "- Use the same language as the user's project conversation when practical.",
].join('\n');

export const USER_MEMORY_SYSTEM_PROMPT = [
  'You maintain a cross-workspace global user design memory for Open CoDesign.',
  'Output ONLY the memory file content in the specified format. No preamble.',
  '',
  'Format:',
  '---',
  'schemaVersion: 1',
  'scope: user',
  'updatedAt: "<ISO timestamp>"',
  '---',
  '',
  '# User Design Memory',
  '',
  '## Taste Profile',
  '- Long-running aesthetic and UX tendencies.',
  '',
  '## Persistent Preferences',
  '- Stable preferences across projects.',
  '',
  '## Strong Dislikes',
  '- Repeated negative preferences.',
  '',
  '## Workflow Preferences',
  '- How the user likes the design agent to work.',
  '',
  '## Common Defaults',
  '- Default density, language, validation, artifact habits.',
  '',
  '## Recent Evidence',
  '- Dated evidence supporting the preferences above.',
  '',
  'Rules:',
  '- Record only long-running cross-workspace preferences and taste.',
  '- Do NOT record project-specific artifact state.',
  '- Do NOT record brand token tables.',
  '- Do NOT record API keys, secrets, or private file paths.',
  '- Preserve existing durable preferences unless new evidence clearly updates them.',
  '- Keep total file under 4000 characters.',
].join('\n');

interface MemoryModelInput {
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  logger?: CoreLogger | undefined;
}

export interface UpdateWorkspaceMemoryInput extends MemoryModelInput {
  existingMemory: string | null;
  conversationMessages: AgentMessage[];
  workspaceName: string;
  designId: string;
  designName: string;
  userMemory: string | null;
  designMdSummary: string | null;
  mergeDraft?: string | undefined;
}

export interface UpdateUserMemoryInput extends MemoryModelInput {
  existingMemory: string | null;
  candidates: string[];
}

export interface UpdateMemoryResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

async function completeMemoryUpdate(
  input: MemoryModelInput,
  systemPrompt: string,
  userContent: string,
  logLabel: string,
): Promise<UpdateMemoryResult> {
  const log = input.logger ?? NOOP_LOGGER;
  const started = Date.now();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
  log.info(`[${logLabel}] step=summarize`, { userContentLen: userContent.length });
  try {
    const result = await completeWithRetry(
      input.model,
      messages,
      {
        apiKey: input.apiKey,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
        ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
        ...(input.allowKeyless === true ? { allowKeyless: true } : {}),
        ...(input.reasoningLevel !== undefined ? { reasoning: input.reasoningLevel } : {}),
        maxTokens: MEMORY_MAX_OUTPUT_TOKENS,
      },
      {
        logger: log,
        provider: input.model.provider,
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
      },
    );
    log.info(`[${logLabel}] step=summarize.ok`, {
      ms: Date.now() - started,
      outputLen: result.content.length,
    });
    return {
      content: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    };
  } catch (err) {
    log.error(`[${logLabel}] step=summarize.fail`, {
      ms: Date.now() - started,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    throw remapProviderError(err, input.model.provider, input.wire);
  }
}

export async function updateWorkspaceMemory(
  input: UpdateWorkspaceMemoryInput,
): Promise<UpdateMemoryResult> {
  const serialized = serializeMessagesForMemory(input.conversationMessages);
  const userContent = [
    '## Existing Workspace MEMORY.md',
    input.existingMemory ?? '(none)',
    '',
    '## Global User Memory',
    input.userMemory ?? '(none)',
    '',
    '## DESIGN.md Summary',
    input.designMdSummary ?? '(none)',
    '',
    input.mergeDraft ? ['## Prior Draft To Merge', input.mergeDraft, ''].join('\n') : '',
    '## Conversation Context',
    serialized,
    '',
    '## Metadata',
    `workspaceName: ${input.workspaceName}`,
    `designId: ${input.designId}`,
    `designName: ${input.designName}`,
    `timestamp: ${new Date().toISOString()}`,
    '',
    'Return the updated workspace MEMORY.md now.',
  ]
    .filter((part) => part.length > 0)
    .join('\n');
  return completeMemoryUpdate(
    input,
    WORKSPACE_MEMORY_SYSTEM_PROMPT,
    userContent,
    'workspace-memory',
  );
}

export async function updateUserMemory(input: UpdateUserMemoryInput): Promise<UpdateMemoryResult> {
  const userContent = [
    '## Existing Global User Memory',
    input.existingMemory ?? '(none)',
    '',
    '## Candidate Evidence',
    input.candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join('\n'),
    '',
    `timestamp: ${new Date().toISOString()}`,
    '',
    'Return the updated global user memory now.',
  ].join('\n');
  return completeMemoryUpdate(input, USER_MEMORY_SYSTEM_PROMPT, userContent, 'user-memory');
}

export function formatMemoryContext(input: {
  userMemory: string | null;
  workspaceMemory: string | null;
}): string[] {
  const sections: string[] = [];
  if (input.userMemory && input.userMemory.trim().length > 0) {
    sections.push(
      formatUntrustedContext(
        'global_user_memory',
        'The following is the user-level long-running design preference memory.',
        input.userMemory.trim(),
      ),
    );
  }
  if (input.workspaceMemory && input.workspaceMemory.trim().length > 0) {
    sections.push(
      formatUntrustedContext(
        'workspace_memory',
        'The following is the user-readable MEMORY.md for the current workspace.',
        input.workspaceMemory.trim(),
      ),
    );
  }
  return sections;
}

export function formatMemoryForDebug(content: string): string {
  return escapeUntrustedXml(content);
}
