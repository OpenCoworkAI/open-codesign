import type { ChatAppendInput, ChatMessageRow } from '@open-codesign/shared';
import type { AgentStreamEvent } from '../preload/index';
import {
  appendSessionActiveMessage,
  appendSessionChatMessage,
  appendSessionToolStatus,
  listSessionActiveMessages,
  listSessionChatMessages,
  type SessionChatStoreOptions,
} from './session-chat';

function payload(row: ChatMessageRow): Record<string, unknown> {
  return (row.payload ?? {}) as Record<string, unknown>;
}

/** The journal is authoritative; replay repairs a crash between journal and chat writes. */
export function projectRunEventToChat(
  opts: SessionChatStoreOptions,
  event: AgentStreamEvent,
): void {
  if (event.seq === undefined) return;
  if (event.type === 'active_message' && event.activeMessage) {
    const message = event.activeMessage;
    const previous = listSessionActiveMessages(opts, event.designId).find(
      (row) => row.messageId === message.messageId,
    );
    if (
      !previous ||
      (previous.status === 'pending' && message.status !== 'pending') ||
      (previous.status === 'not-delivered' && message.status === 'delivered')
    )
      appendSessionActiveMessage(opts, message);
    return;
  }
  if (
    !['turn_end', 'tool_call_start', 'tool_call_result', 'error', 'run_settled'].includes(
      event.type,
    )
  )
    return;
  const rows = listSessionChatMessages(opts, event.designId);
  const key = `${event.generationId}:${event.seq}`;
  const append = (kind: ChatAppendInput['kind'], data: Record<string, unknown>, suffix = '') => {
    const eventKey = key + suffix;
    if (rows.some((row) => payload(row)['runEventKey'] === eventKey)) return;
    appendSessionChatMessage(opts, {
      designId: event.designId,
      kind,
      payload: { ...data, runId: event.generationId, runEventKey: eventKey },
    });
  };
  if (event.type === 'turn_end') {
    const text = event.finalText?.trim();
    if (text) append('assistant_text', { text });
  } else if (event.type === 'tool_call_start') {
    append('tool_call', {
      toolName: event.toolName ?? 'unknown',
      args: event.args ?? {},
      status: event.status ?? 'running',
      toolCallId: event.toolCallId,
      command: event.command,
      result: event.result,
      durationMs: event.durationMs,
      verbGroup: event.verbGroup ?? 'Working',
      ...(event.message ? { error: { message: event.message } } : {}),
    });
  } else if (event.type === 'tool_call_result') {
    const row = rows.find(
      (row) =>
        row.kind === 'tool_call' &&
        payload(row)['runId'] === event.generationId &&
        payload(row)['toolCallId'] === event.toolCallId,
    );
    if (row) {
      const appliedKey = payload(row)['runResultEventKey'];
      const prefix = `${event.generationId}:`;
      const appliedSeq =
        typeof appliedKey === 'string' && appliedKey.startsWith(prefix)
          ? Number(appliedKey.slice(prefix.length))
          : 0;
      if (Number.isSafeInteger(appliedSeq) && appliedSeq >= event.seq) return;
      appendSessionToolStatus(opts, {
        designId: event.designId,
        seq: row.seq,
        runResultEventKey: key,
        status: event.status === 'error' ? 'error' : 'done',
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        ...(event.message !== undefined ? { errorMessage: event.message } : {}),
      });
    }
  } else if (event.type === 'error') {
    append('error', { message: event.message ?? 'Unknown error', code: event.code });
  } else if (event.type === 'run_settled') {
    for (const row of rows) {
      if (
        row.kind !== 'tool_call' ||
        payload(row)['runId'] !== event.generationId ||
        payload(row)['status'] !== 'running'
      )
        continue;
      appendSessionToolStatus(opts, {
        designId: event.designId,
        seq: row.seq,
        status: event.outcome === 'completed' ? 'done' : 'error',
        ...(event.message ? { errorMessage: event.message } : {}),
      });
    }
    if (event.outcome === 'failed' || event.outcome === 'interrupted') {
      append('error', { message: event.message ?? 'Run interrupted', code: event.code });
    }
    const response = event.response;
    if (response) {
      if (
        response.message.trim() &&
        !rows.some(
          (row) => row.kind === 'assistant_text' && payload(row)['runId'] === event.generationId,
        )
      )
        append('assistant_text', { text: response.message }, ':message');
      const first = response.artifacts[0];
      const filename =
        first?.entryPath ??
        (first
          ? 'App.jsx'
          : response.resourceState?.lastDone?.status === 'ok'
            ? response.resourceState.lastDone.path
            : undefined);
      if (filename)
        append(
          'artifact_delivered',
          { filename, createdAt: new Date().toISOString() },
          ':artifact',
        );
    }
  }
}
