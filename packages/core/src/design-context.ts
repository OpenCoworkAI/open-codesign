import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { completeWithRetry } from '@open-codesign/providers';
import type {
  ChatMessage,
  ChatMessageRow,
  DesignRunPreferencesV1,
  ModelRef,
  ReasoningLevel,
  ResourceStateV1,
  WireApi,
} from '@open-codesign/shared';
import { remapProviderError } from './errors.js';
import { escapeUntrustedXml, formatUntrustedContext } from './lib/context-format.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';
import { serializeMessagesForMemory } from './memory.js';

export interface DesignSessionBriefV1 {
  schemaVersion: 1;
  designId: string;
  designName: string;
  updatedAt: string;
  goal: string;
  artifactType: string;
  audience: string;
  visualDirection: string;
  stableDecisions: string[];
  userPreferences: string[];
  dislikes: string[];
  openTasks: string[];
  currentFiles: string[];
  lastVerification: {
    status: 'none' | 'ok' | 'has_errors';
    path?: string;
    errorCount?: number;
    checkedAt?: string;
  };
  lastUserIntent: string;
  sourceUserMemoryHash?: string;
  sourceWorkspaceMemoryHash?: string;
  sourceMemoryUpdatedAt?: string;
}

export interface DesignContextPackV1 {
  history: ChatMessage[];
  contextSections: string[];
  trace: ContextBudgetTrace;
}

export interface ContextBudgetTrace {
  briefChars: number;
  historyChars: number;
  selectedMessages: number;
  droppedMessages: number;
  contextBudgetChars: number;
  sessionContextChars: number;
}

export interface BuildDesignContextPackInput {
  chatRows: readonly ChatMessageRow[];
  brief?: DesignSessionBriefV1 | null | undefined;
  resourceState?: ResourceStateV1 | undefined;
  runPreferences?: DesignRunPreferencesV1 | null | undefined;
  workspaceState?: {
    sourcePath?: string | null | undefined;
    hasSource?: boolean | undefined;
    hasDesignMd?: boolean | undefined;
    hasAgentsMd?: boolean | undefined;
    hasSettingsJson?: boolean | undefined;
  };
  historyBudgetChars?: number | undefined;
  modelContextWindow?: number | undefined;
}

export interface UpdateDesignSessionBriefInput {
  existingBrief: DesignSessionBriefV1 | null;
  conversationMessages: AgentMessage[];
  designId: string;
  designName: string;
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  userMemory?: string | null | undefined;
  workspaceMemory?: string | null | undefined;
  sourceUserMemoryHash?: string | undefined;
  sourceWorkspaceMemoryHash?: string | undefined;
  sourceMemoryUpdatedAt?: string | undefined;
  logger?: CoreLogger | undefined;
}

export interface UpdateDesignSessionBriefResult {
  brief: DesignSessionBriefV1;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const MIN_HISTORY_BUDGET_CHARS = 4_000;
const DEFAULT_HISTORY_BUDGET_CHARS = 12_000;
const MAX_HISTORY_BUDGET_CHARS = 24_000;
const RECENT_USER_TURNS_TO_PIN = 2;
const BRIEF_MAX_ARRAY_ITEMS = 12;
const BRIEF_MAX_FIELD_CHARS = 1_200;
const BRIEF_MAX_ITEM_CHARS = 240;
const BRIEF_MAX_OUTPUT_TOKENS = 2_000;

export const DESIGN_BRIEF_SYSTEM_PROMPT = [
  'You maintain a compact structured brief for one Open CoDesign design session.',
  'Output ONLY valid JSON. No markdown, no commentary, no code fences.',
  '',
  'Required JSON fields:',
  '- goal: string',
  '- artifactType: string',
  '- audience: string',
  '- visualDirection: string',
  '- stableDecisions: string[]',
  '- userPreferences: string[]',
  '- dislikes: string[]',
  '- openTasks: string[]',
  '- currentFiles: string[]',
  '- lastVerification: { status: "none" | "ok" | "has_errors", path?: string, errorCount?: number, checkedAt?: string }',
  '- lastUserIntent: string',
  '- sourceUserMemoryHash?: string',
  '- sourceWorkspaceMemoryHash?: string',
  '- sourceMemoryUpdatedAt?: string',
  '',
  'Rules:',
  '- Derive durable design facts from Workspace MEMORY.md and Global User Memory first.',
  '- Use recent conversation only as fresh evidence, not as a replacement for memory files.',
  '- Do not copy large source code, tool outputs, or full token tables.',
  '- Treat DESIGN.md as authoritative when mentioned; summarize decisions, not raw tokens.',
  "- Use the same language as the user's prompts when practical.",
  '- Keep the whole JSON compact enough for a prompt brief.',
].join('\n');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function stringField(value: unknown, fallback = ''): string {
  return truncate(typeof value === 'string' ? value : fallback, BRIEF_MAX_FIELD_CHARS);
}

function optionalStringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = truncate(value, BRIEF_MAX_FIELD_CHARS);
  return text.length > 0 ? text : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = truncate(item, BRIEF_MAX_ITEM_CHARS);
    if (text.length > 0 && !out.includes(text)) out.push(text);
    if (out.length >= BRIEF_MAX_ARRAY_ITEMS) break;
  }
  return out;
}

function normalizeLastVerification(value: unknown): DesignSessionBriefV1['lastVerification'] {
  if (!isRecord(value)) return { status: 'none' };
  const status = value['status'];
  const normalized: DesignSessionBriefV1['lastVerification'] =
    status === 'ok' || status === 'has_errors' ? { status } : { status: 'none' };
  if (typeof value['path'] === 'string' && value['path'].trim().length > 0) {
    normalized.path = truncate(value['path'], 200);
  }
  if (typeof value['errorCount'] === 'number' && Number.isFinite(value['errorCount'])) {
    normalized.errorCount = Math.max(0, Math.floor(value['errorCount']));
  }
  if (typeof value['checkedAt'] === 'string' && value['checkedAt'].trim().length > 0) {
    normalized.checkedAt = truncate(value['checkedAt'], 80);
  }
  return normalized;
}

export function normalizeDesignSessionBrief(
  raw: unknown,
  meta: { designId: string; designName: string; now?: string },
): DesignSessionBriefV1 | null {
  if (!isRecord(raw)) return null;
  const out: DesignSessionBriefV1 = {
    schemaVersion: 1,
    designId: meta.designId,
    designName: meta.designName,
    updatedAt: meta.now ?? new Date().toISOString(),
    goal: stringField(raw['goal']),
    artifactType: stringField(raw['artifactType']),
    audience: stringField(raw['audience']),
    visualDirection: stringField(raw['visualDirection']),
    stableDecisions: stringArray(raw['stableDecisions']),
    userPreferences: stringArray(raw['userPreferences']),
    dislikes: stringArray(raw['dislikes']),
    openTasks: stringArray(raw['openTasks']),
    currentFiles: stringArray(raw['currentFiles']),
    lastVerification: normalizeLastVerification(raw['lastVerification']),
    lastUserIntent: stringField(raw['lastUserIntent']),
  };
  const sourceUserMemoryHash = optionalStringField(raw['sourceUserMemoryHash']);
  if (sourceUserMemoryHash !== undefined) out.sourceUserMemoryHash = sourceUserMemoryHash;
  const sourceWorkspaceMemoryHash = optionalStringField(raw['sourceWorkspaceMemoryHash']);
  if (sourceWorkspaceMemoryHash !== undefined)
    out.sourceWorkspaceMemoryHash = sourceWorkspaceMemoryHash;
  const sourceMemoryUpdatedAt = optionalStringField(raw['sourceMemoryUpdatedAt']);
  if (sourceMemoryUpdatedAt !== undefined) out.sourceMemoryUpdatedAt = sourceMemoryUpdatedAt;
  return out;
}

function messageFromRow(row: ChatMessageRow): ChatMessage | null {
  const payload = isRecord(row.payload) ? row.payload : {};
  const text = typeof payload['text'] === 'string' ? payload['text'].trim() : '';
  if (text.length === 0) return null;
  if (row.kind === 'user') return { role: 'user', content: text };
  if (row.kind === 'assistant_text') return { role: 'assistant', content: text };
  return null;
}

function messageChars(message: ChatMessage): number {
  return message.role.length + message.content.length + 1;
}

function historyBudgetChars(input: BuildDesignContextPackInput): number {
  if (typeof input.historyBudgetChars === 'number' && Number.isFinite(input.historyBudgetChars)) {
    return clamp(Math.floor(input.historyBudgetChars), 0, MAX_HISTORY_BUDGET_CHARS);
  }
  if (
    typeof input.modelContextWindow === 'number' &&
    Number.isFinite(input.modelContextWindow) &&
    input.modelContextWindow > 0
  ) {
    // Use model size as a floor-pressure signal, not an invitation to stuff
    // huge history into large-context models. Workspace files remain the source
    // of truth; history is only intent tracking.
    return clamp(
      Math.floor(input.modelContextWindow * 0.06),
      MIN_HISTORY_BUDGET_CHARS,
      DEFAULT_HISTORY_BUDGET_CHARS,
    );
  }
  return DEFAULT_HISTORY_BUDGET_CHARS;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
function selectBudgetedHistory(
  messages: ChatMessage[],
  budget: number,
): {
  history: ChatMessage[];
  chars: number;
} {
  if (messages.length === 0 || budget <= 0) return { history: [], chars: 0 };
  let pinnedStart = messages.length;
  let seenUsers = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      seenUsers += 1;
      if (seenUsers >= RECENT_USER_TURNS_TO_PIN) {
        pinnedStart = index;
        break;
      }
    }
  }
  if (seenUsers < RECENT_USER_TURNS_TO_PIN) pinnedStart = 0;

  const selected = new Set<number>();
  let chars = 0;
  for (let index = pinnedStart; index < messages.length; index += 1) {
    const msg = messages[index];
    if (!msg) continue;
    const len = messageChars(msg);
    if (chars + len > budget && selected.size > 0) break;
    if (chars + len > budget && selected.size === 0) continue;
    selected.add(index);
    chars += len;
  }

  for (let index = pinnedStart - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (!msg) continue;
    const len = messageChars(msg);
    if (chars + len > budget) break;
    selected.add(index);
    chars += len;
  }

  if (selected.size === 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const msg = messages[index];
      if (!msg) continue;
      const len = messageChars(msg);
      if (chars + len > budget && selected.size > 0) break;
      if (len > budget) continue;
      selected.add(index);
      chars += len;
    }
  }

  const history = [...selected]
    .sort((a, b) => a - b)
    .map((index) => messages[index])
    .filter((message): message is ChatMessage => message !== undefined);
  return { history, chars };
}

function formatBriefContext(brief: DesignSessionBriefV1): string {
  return formatUntrustedContext(
    'design_session_brief',
    'The following is the durable brief for this design session.',
    JSON.stringify(brief, null, 2),
  );
}

function formatWorkspaceContext(input: BuildDesignContextPackInput): string {
  const state = input.workspaceState ?? {};
  const lines = [
    '# Design Context Pack',
    '',
    'Workspace status:',
    `- activeSource: ${state.sourcePath ?? 'unknown'}`,
    `- hasSource: ${state.hasSource === true ? 'yes' : 'no'}`,
    `- hasDesignMd: ${state.hasDesignMd === true ? 'yes' : 'no'}`,
    `- hasAgentsMd: ${state.hasAgentsMd === true ? 'yes' : 'no'}`,
    `- hasSettingsJson: ${state.hasSettingsJson === true ? 'yes' : 'no'}`,
  ];
  const resource = input.resourceState;
  if (resource) {
    lines.push('', 'Resource state:');
    lines.push(`- loadedSkills: ${resource.loadedSkills.join(', ') || 'none'}`);
    lines.push(`- loadedBrandRefs: ${resource.loadedBrandRefs.join(', ') || 'none'}`);
    lines.push(`- scaffoldedFiles: ${resource.scaffoldedFiles.length}`);
    lines.push(
      `- lastDone: ${resource.lastDone ? `${resource.lastDone.status} ${resource.lastDone.path}` : 'none'}`,
    );
  }
  if (input.runPreferences) {
    lines.push('', 'Run preferences:');
    lines.push(`- tweaks: ${input.runPreferences.tweaks}`);
    lines.push(`- bitmapAssets: ${input.runPreferences.bitmapAssets}`);
    lines.push(`- reusableSystem: ${input.runPreferences.reusableSystem}`);
    if (input.runPreferences.visualDirection) {
      lines.push(`- visualDirection: ${input.runPreferences.visualDirection}`);
    }
  }
  return formatUntrustedContext(
    'design_context_pack',
    'The following is host-computed turn state for this design session.',
    lines.join('\n'),
  );
}

export function buildDesignContextPack(input: BuildDesignContextPackInput): DesignContextPackV1 {
  const allMessages = input.chatRows
    .map(messageFromRow)
    .filter((message): message is ChatMessage => message !== null);
  const contextBudgetChars = historyBudgetChars(input);
  const selected = selectBudgetedHistory(allMessages, contextBudgetChars);
  const contextSections: string[] = [];
  if (input.brief) contextSections.push(formatBriefContext(input.brief));
  contextSections.push(formatWorkspaceContext(input));
  const briefChars = input.brief ? JSON.stringify(input.brief).length : 0;
  const sessionContextChars = contextSections.reduce((sum, section) => sum + section.length, 0);
  return {
    history: selected.history,
    contextSections,
    trace: {
      briefChars,
      historyChars: selected.chars,
      selectedMessages: selected.history.length,
      droppedMessages: allMessages.length - selected.history.length,
      contextBudgetChars,
      sessionContextChars,
    },
  };
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
export async function updateDesignSessionBrief(
  input: UpdateDesignSessionBriefInput,
): Promise<UpdateDesignSessionBriefResult> {
  const log = input.logger ?? NOOP_LOGGER;
  const conversation = serializeMessagesForMemory(input.conversationMessages);
  const userContent = [
    '## Existing Brief',
    input.existingBrief ? JSON.stringify(input.existingBrief, null, 2) : '(none)',
    '',
    '## Global User Memory',
    input.userMemory ?? '(none)',
    '',
    '## Workspace MEMORY.md',
    input.workspaceMemory ?? '(none)',
    '',
    '## Conversation Context',
    conversation,
    '',
    '## Metadata',
    `designId: ${input.designId}`,
    `designName: ${input.designName}`,
    `sourceUserMemoryHash: ${input.sourceUserMemoryHash ?? ''}`,
    `sourceWorkspaceMemoryHash: ${input.sourceWorkspaceMemoryHash ?? ''}`,
    `sourceMemoryUpdatedAt: ${input.sourceMemoryUpdatedAt ?? ''}`,
    `timestamp: ${new Date().toISOString()}`,
    '',
    'Return the updated brief JSON now.',
  ].join('\n');
  const messages: ChatMessage[] = [
    { role: 'system', content: DESIGN_BRIEF_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
  log.info('[design-brief] step=summarize', {
    designId: input.designId,
    existingBrief: input.existingBrief !== null,
    conversationLen: conversation.length,
  });
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
        maxTokens: BRIEF_MAX_OUTPUT_TOKENS,
      },
      {
        logger: log,
        provider: input.model.provider,
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
      },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(result.content)) as unknown;
    } catch (cause) {
      throw new Error(
        `Design session brief updater must return valid JSON: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
    const brief = normalizeDesignSessionBrief(parsed, {
      designId: input.designId,
      designName: input.designName,
    });
    if (brief === null) {
      throw new Error('Design session brief updater returned a non-object JSON value');
    }
    log.info('[design-brief] step=summarize.ok', {
      designId: input.designId,
      outputLen: JSON.stringify(brief).length,
    });
    return {
      brief,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    };
  } catch (err) {
    log.warn('[design-brief] step=summarize.fail', {
      designId: input.designId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw remapProviderError(err, input.model.provider, input.wire);
  }
}

export function formatDesignSessionBriefForDebug(brief: DesignSessionBriefV1): string {
  return escapeUntrustedXml(JSON.stringify(brief));
}
