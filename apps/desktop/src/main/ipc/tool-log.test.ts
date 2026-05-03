import type { AgentEvent } from '@open-codesign/core';
import { describe, expect, it } from 'vitest';
import { toolExecutionIsErrorForLog } from './tool-log';

type ToolExecutionEndEvent = Extract<AgentEvent, { type: 'tool_execution_end' }>;

function toolEnd(overrides: Partial<ToolExecutionEndEvent>): ToolExecutionEndEvent {
  return {
    type: 'tool_execution_end',
    toolCallId: 'tool-1',
    toolName: 'set_todos',
    isError: true,
    result: {
      content: [{ type: 'text', text: '[ ] Check work' }],
      details: { items: [{ text: 'Check work', checked: false }] },
    },
    ...overrides,
  } as ToolExecutionEndEvent;
}

describe('toolExecutionIsErrorForLog', () => {
  it('suppresses only the known successful set_todos false-positive shape', () => {
    expect(toolExecutionIsErrorForLog(toolEnd({}))).toBe(false);
  });

  it('preserves genuine set_todos errors when the result includes an error signal', () => {
    expect(
      toolExecutionIsErrorForLog(
        toolEnd({
          result: {
            content: [{ type: 'text', text: '[ ] Check work' }],
            details: { items: [{ text: 'Check work', checked: false }] },
            errorMessage: 'Failed to persist todos',
          },
        }),
      ),
    ).toBe(true);
  });

  it('preserves set_todos errors when the result shape is not the tool success payload', () => {
    expect(
      toolExecutionIsErrorForLog(
        toolEnd({
          result: {
            content: [{ type: 'text', text: '[ ] Check work' }],
            details: { items: [{ text: 'Check work', checked: 'no' }] },
          },
        }),
      ),
    ).toBe(true);
  });

  it('leaves non-set_todos tool errors untouched', () => {
    expect(toolExecutionIsErrorForLog(toolEnd({ toolName: 'read' }))).toBe(true);
  });
});
