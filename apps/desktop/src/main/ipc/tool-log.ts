import type { AgentEvent } from '@open-codesign/core';

type ToolExecutionEndEvent = Extract<AgentEvent, { type: 'tool_execution_end' }>;
type ToolStreamStatus = { status: 'done' | 'error'; errorMessage?: string };
type DoneErrorPreview = { message: string; source?: string; lineno?: number };
const STREAM_TOOL_TEXT_LIMIT_BYTES = 8 * 1024;
const HISTORY_DETAIL_LIMIT_BYTES = 4 * 1024;
const PREVIEW_DOM_OUTLINE_LIMIT = 2 * 1024;
const DONE_ERROR_PREVIEW_LIMIT = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSetTodosItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'text' || key === 'checked') &&
    typeof value['text'] === 'string' &&
    typeof value['checked'] === 'boolean'
  );
}

function isSetTodosTextContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'type' || key === 'text') &&
    value['type'] === 'text' &&
    typeof value['text'] === 'string'
  );
}

function isSuccessfulSetTodosResult(result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (!Object.keys(result).every((key) => key === 'content' || key === 'details')) return false;

  const details = result['details'];
  if (!isRecord(details)) return false;
  if (!Object.keys(details).every((key) => key === 'items')) return false;
  const items = details['items'];
  if (!Array.isArray(items) || !items.every(isSetTodosItem)) return false;

  const content = result['content'];
  return Array.isArray(content) && content.length > 0 && content.every(isSetTodosTextContent);
}

export function toolExecutionIsErrorForLog(event: ToolExecutionEndEvent): boolean {
  if (event.toolName !== 'set_todos' || !event.isError) return event.isError;
  return !isSuccessfulSetTodosResult(event.result);
}

function textFromToolResult(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const content = result['content'];
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .map((item) =>
      isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string'
        ? item['text']
        : '',
    )
    .filter((text) => text.length > 0);
  return texts.length > 0 ? texts.join('\n') : undefined;
}

function withSummaryText(result: unknown, text: string): unknown {
  if (!isRecord(result)) return result;
  return {
    ...result,
    content: [{ type: 'text', text }],
  };
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, limit - 3)}...`;
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function compactPreviewDetails(details: Record<string, unknown>): Record<string, unknown> {
  const consoleErrors = Array.isArray(details['consoleErrors'])
    ? details['consoleErrors'].slice(0, 10)
    : undefined;
  const assetErrors = Array.isArray(details['assetErrors'])
    ? details['assetErrors'].slice(0, 10)
    : undefined;
  const domOutline =
    typeof details['domOutline'] === 'string'
      ? truncateText(details['domOutline'], PREVIEW_DOM_OUTLINE_LIMIT)
      : undefined;
  const metrics = isRecord(details['metrics']) ? details['metrics'] : undefined;
  const reason = typeof details['reason'] === 'string' ? details['reason'] : undefined;
  return {
    ...(typeof details['ok'] === 'boolean' ? { ok: details['ok'] } : {}),
    ...(metrics !== undefined ? { metrics } : {}),
    ...(consoleErrors !== undefined ? { consoleErrors } : {}),
    ...(assetErrors !== undefined ? { assetErrors } : {}),
    ...(domOutline !== undefined ? { domOutline } : {}),
    ...(reason !== undefined ? { reason } : {}),
    screenshot: '[stripped for chat history]',
    summarized: true,
  };
}

function compactDoneFindings(
  details: Record<string, unknown>,
  key: 'errors' | 'warnings',
): { count: number; preview: DoneErrorPreview[] } {
  const countKey = key === 'errors' ? 'errorCount' : 'warningCount';
  const previewKey = key === 'errors' ? 'errorsPreview' : 'warningsPreview';
  const raw = details[key];
  const previous = details[previewKey];
  const findings = Array.isArray(raw) ? raw : Array.isArray(previous) ? previous : [];
  const previousCount = details[countKey];
  const count =
    !Array.isArray(raw) &&
    typeof previousCount === 'number' &&
    Number.isSafeInteger(previousCount) &&
    previousCount >= findings.length
      ? previousCount
      : findings.length;
  const preview = findings
    .slice(0, DONE_ERROR_PREVIEW_LIMIT)
    .map((item) => {
      if (!isRecord(item)) return null;
      const message = typeof item['message'] === 'string' ? item['message'] : null;
      if (message === null) return null;
      return {
        message: truncateText(message, 1_000),
        ...(typeof item['source'] === 'string'
          ? { source: truncateText(item['source'], 256) }
          : {}),
        ...(typeof item['lineno'] === 'number' ? { lineno: item['lineno'] } : {}),
      };
    })
    .filter((item): item is DoneErrorPreview => item !== null);
  return { count, preview };
}

function compactDoneDetails(details: Record<string, unknown>): Record<string, unknown> {
  const status = details['status'];
  const path = details['path'];
  const summary =
    typeof details['summary'] === 'string' ? truncateText(details['summary'], 2_000) : undefined;
  const errors = compactDoneFindings(details, 'errors');
  const warnings = compactDoneFindings(details, 'warnings');
  return {
    ...(typeof status === 'string' ? { status } : {}),
    ...(typeof path === 'string' ? { path } : {}),
    errorCount: errors.count,
    errorsPreview: errors.preview,
    ...(warnings.count > 0
      ? {
          warningCount: warnings.count,
          warningsPreview: warnings.preview,
        }
      : {}),
    ...(summary !== undefined ? { summary } : {}),
    summarized: true,
  };
}

function compactDetailsForHistory(toolName: string, details: unknown): unknown {
  if (!isRecord(details)) return details;
  if (toolName === 'preview') return compactPreviewDetails(details);
  if (toolName === 'done') return compactDoneDetails(details);
  if (jsonSize(details) <= HISTORY_DETAIL_LIMIT_BYTES) return details;
  return {
    summarized: true,
    toolName,
    keys: Object.keys(details).slice(0, 12),
  };
}

export function compactToolResultForHistory(toolName: string, result: unknown): unknown {
  if (!isRecord(result)) return result;
  const content = Array.isArray(result['content']) ? result['content'] : undefined;
  const details = result['details'];
  const nextContent =
    content === undefined
      ? undefined
      : content.map((item) => {
          if (!isRecord(item) || item['type'] !== 'text' || typeof item['text'] !== 'string') {
            return item;
          }
          return {
            ...item,
            text: truncateText(item['text'], STREAM_TOOL_TEXT_LIMIT_BYTES),
          };
        });
  return {
    ...result,
    ...(nextContent !== undefined ? { content: nextContent } : {}),
    ...(details !== undefined ? { details: compactDetailsForHistory(toolName, details) } : {}),
  };
}

function skillSummaryFromResult(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const details = result['details'];
  if (!isRecord(details)) return undefined;
  const name = typeof details['name'] === 'string' ? details['name'] : 'skill';
  const status = details['status'];
  if (status === 'loaded') {
    const description = typeof details['description'] === 'string' ? details['description'] : '';
    const trimmedDescription = description.replace(/[.!\s]+$/u, '');
    return trimmedDescription.length > 0
      ? `Loaded skill ${name}: ${trimmedDescription}.`
      : `Loaded skill ${name}.`;
  }
  if (status === 'already-loaded') return `Skill ${name} already loaded.`;
  if (status === 'not-found') return `Skill ${name} not found.`;
  return undefined;
}

export function summarizeToolResultForStream(
  toolName: string,
  result: unknown,
  limitBytes = STREAM_TOOL_TEXT_LIMIT_BYTES,
): unknown {
  const compacted = compactToolResultForHistory(toolName, result);
  const text = textFromToolResult(compacted);
  if (text === undefined) return compacted;
  if (toolName === 'skill') {
    return withSummaryText(
      compacted,
      skillSummaryFromResult(compacted) ?? 'Skill guidance loaded.',
    );
  }
  if (text.length <= limitBytes) return compacted;
  return withSummaryText(
    compacted,
    `${toolName} result summarized for chat history; see tool details or current workspace state.`,
  );
}

function blockedReasonFromToolResult(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const details = result['details'];
  if (!isRecord(details)) return undefined;
  if (details['status'] === 'blocked') {
    return typeof details['reason'] === 'string' ? details['reason'] : 'blocked';
  }
  const nestedResult = details['result'];
  if (!isRecord(nestedResult)) return undefined;
  if (nestedResult['blocked'] === true) {
    return typeof nestedResult['reason'] === 'string' ? nestedResult['reason'] : 'blocked';
  }
  if (nestedResult['requiresView'] === true) return 'view_required';
  return undefined;
}

export function toolExecutionStatusForStream(event: ToolExecutionEndEvent): ToolStreamStatus {
  const errorMessage = textFromToolResult(event.result);
  if (toolExecutionIsErrorForLog(event)) {
    return { status: 'error', ...(errorMessage !== undefined ? { errorMessage } : {}) };
  }

  const blockedReason = blockedReasonFromToolResult(event.result);
  if (blockedReason !== undefined) {
    return {
      status: 'error',
      errorMessage: errorMessage ?? `Tool call did not mutate the workspace: ${blockedReason}.`,
    };
  }

  return { status: 'done' };
}
