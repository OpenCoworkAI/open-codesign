import type { AgentEvent } from '@open-codesign/core';

type ToolExecutionEndEvent = Extract<AgentEvent, { type: 'tool_execution_end' }>;

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
