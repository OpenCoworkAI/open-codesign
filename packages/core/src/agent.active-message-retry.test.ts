import type { Agent, AgentMessage, AgentOptions, StreamFn } from '@mariozechner/pi-agent-core';
import { type AssistantMessage, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { ActiveRunMessageV1 } from '@open-codesign/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveRunMessages } from './active-messages';
import { generateViaAgent } from './agent';

const native = vi.hoisted(() => ({
  stream: vi.fn<StreamFn>(),
  agents: [] as Agent[],
}));

vi.mock('@mariozechner/pi-agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-agent-core')>();
  return {
    ...actual,
    Agent: class extends actual.Agent {
      constructor(options: AgentOptions) {
        super({ ...options, streamFn: native.stream });
        native.agents.push(this);
      }
    },
  };
});

vi.mock('./skills/loader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./skills/loader.js')>()),
  loadBuiltinSkills: async () => [],
}));

function userText(message: AgentMessage | undefined): string {
  if (message?.role !== 'user') return '';
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

beforeEach(() => {
  native.stream.mockReset();
  native.agents.length = 0;
});

describe('generateViaAgent native pi active-message recovery', () => {
  it.each(
    [
      ['fetch failed: terminated'],
      ['reasoning_content is missing'],
      ['reasoning_content is missing', 'fetch failed: terminated'],
      ['fetch failed: terminated', 'reasoning_content is missing'],
    ].flatMap((errors) =>
      (['follow-up', 'steer'] as const).flatMap((mode) =>
        [false, true].map((toolsBeforeFailure) => ({ errors, mode, toolsBeforeFailure })),
      ),
    ),
  )('retains delivered and pending instructions: $errors / $mode / tools=$toolsBeforeFailure', async ({
    errors,
    mode,
    toolsBeforeFailure,
  }) => {
    const receipts: ActiveRunMessageV1[] = [];
    const deliveredUsers: AgentMessage[] = [];
    const contexts: AgentMessage[][] = [];
    const active = new ActiveRunMessages('design', 'run', (row) => receipts.push(row));
    const submit = (text: string, messageMode: 'follow-up' | 'steer' = 'follow-up') =>
      active.submit({
        schemaVersion: 1,
        designId: 'design',
        generationId: 'run',
        messageId: text,
        mode: messageMode,
        text,
      });
    let newAttempts = 0;
    let queuedEarlier = false;
    let queuedNew = false;
    let failures = 0;
    const html = '<!doctype html><html><body><h1>Retained artifact</h1></body></html>';
    const files = new Map([['App.jsx', html]]);
    const create = vi.fn((path: string, content: string) => {
      files.set(path, content);
      return { path };
    });
    const toolEvents: string[] = [];

    native.stream.mockImplementation((model, context) => {
      contexts.push([...context.messages]);
      const users = context.messages.filter((message) => message.role === 'user');
      const latest = users.at(-1);
      const text = latest ? userText(latest) : '';
      let content: AssistantMessage['content'] = [{ type: 'text', text: 'Completed' }];
      let stopReason: AssistantMessage['stopReason'] = 'stop';
      let errorMessage: string | undefined;
      if (!queuedEarlier) {
        queuedEarlier = true;
        submit('EARLIER');
      } else if (text === 'EARLIER' && !queuedNew) {
        queuedNew = true;
        submit('NEW INSTRUCTION', mode);
        submit('LATER');
        submit('LAST');
      } else if (text === 'NEW INSTRUCTION') {
        newAttempts++;
        if (toolsBeforeFailure && newAttempts === 1) {
          stopReason = 'toolUse';
          content = [
            {
              type: 'toolCall',
              id: 'todos-once',
              name: 'set_todos',
              arguments: { items: [{ text: 'Apply new instruction', checked: false }] },
            },
          ];
        } else if (toolsBeforeFailure && newAttempts === 2) {
          stopReason = 'toolUse';
          content = [
            {
              type: 'toolCall',
              id: 'write-once',
              name: 'str_replace_based_edit_tool',
              arguments: { command: 'create', path: 'evidence.txt', file_text: 'written once' },
            },
          ];
        } else if (failures < errors.length) {
          errorMessage = errors[failures++];
          stopReason = 'error';
          content = [];
        }
      }
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content,
        stopReason,
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        ...(errorMessage ? { errorMessage } : {}),
      };
      if (stopReason === 'error') stream.push({ type: 'error', reason: 'error', error: message });
      else stream.push({ type: 'done', reason: stopReason, message });
      return stream;
    });

    const result = await generateViaAgent(
      {
        prompt: 'ORIGINAL',
        history: [],
        model: { provider: 'openai', modelId: 'gpt-5' },
        apiKey: 'synthetic-only',
        reasoningLevel: 'low',
      },
      {
        activeMessages: active,
        fs: {
          view: (path) => {
            const content = files.get(path);
            return content === undefined ? null : { content, numLines: content.split('\n').length };
          },
          create,
          strReplace: (path) => ({ path }),
          insert: (path) => ({ path }),
          listDir: () => [...files.keys()],
        },
        onEvent: (event) => {
          if (event.type === 'message_start' && event.message.role === 'user')
            deliveredUsers.push(event.message);
          if (event.type === 'tool_execution_end') {
            expect(event.isError).toBe(false);
            toolEvents.push(event.toolCallId);
          }
        },
      },
    );

    expect(failures).toBe(errors.length);
    expect(result.artifacts).toHaveLength(1);
    expect(native.agents).toHaveLength(errors.length + 1);
    expect(native.agents.at(-1)?.state.thinkingLevel).toBe(
      errors.some((error) => error.includes('reasoning_content')) ? 'off' : 'low',
    );
    const original = userText(deliveredUsers[0]);
    expect(original).toContain('ORIGINAL');
    const expectedUsers = [original, 'EARLIER', 'NEW INSTRUCTION', 'LATER', 'LAST'];
    expect(deliveredUsers.map(userText)).toEqual(expectedUsers);
    expect(
      native.agents
        .at(-1)
        ?.state.messages.filter((row) => row.role === 'user')
        .map(userText),
    ).toEqual(expectedUsers);
    expect(
      receipts.filter((row) => row.status === 'delivered').map((row) => row.messageId),
    ).toEqual(expectedUsers.slice(1));
    expect(
      receipts.map((row) => row.status).filter((status) => status === 'not-delivered'),
    ).toEqual([]);
    for (const name of expectedUsers.slice(1)) {
      expect(receipts.filter((row) => row.messageId === name).map((row) => row.status)).toEqual([
        'pending',
        'delivered',
      ]);
    }
    const interruptedContexts = contexts.filter(
      (messages) =>
        userText(messages.filter((row) => row.role === 'user').at(-1)) === 'NEW INSTRUCTION',
    );
    expect(interruptedContexts).toHaveLength(errors.length + (toolsBeforeFailure ? 3 : 1));
    const resumed = interruptedContexts.at(-1);
    if (!resumed) throw new Error('Expected the interrupted instruction to resume');
    expect(resumed.filter((row) => row.role === 'user').map(userText)).toEqual(
      expectedUsers.slice(0, 3),
    );
    expect(resumed.filter((row) => row.role === 'user').at(-1)).toEqual(deliveredUsers[2]);
    expect(resumed.some((row) => row.role === 'assistant' && row.stopReason === 'error')).toBe(
      false,
    );
    expect(resumed.filter((row) => row.role === 'toolResult').map((row) => row.toolCallId)).toEqual(
      toolsBeforeFailure ? ['todos-once', 'write-once'] : [],
    );
    expect(toolEvents).toEqual(toolsBeforeFailure ? ['todos-once', 'write-once'] : []);
    expect(create).toHaveBeenCalledTimes(toolsBeforeFailure ? 1 : 0);
  });
});
