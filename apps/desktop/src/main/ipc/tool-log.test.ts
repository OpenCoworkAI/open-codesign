import type { AgentEvent } from '@open-codesign/core';
import { describe, expect, it } from 'vitest';
import {
  compactToolResultForHistory,
  summarizeToolResultForStream,
  toolExecutionIsErrorForLog,
  toolExecutionStatusForStream,
} from './tool-log';

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

describe('toolExecutionStatusForStream', () => {
  it('marks recoverable blocked tool results as error for the renderer', () => {
    const status = toolExecutionStatusForStream(
      toolEnd({
        toolName: 'str_replace_based_edit_tool',
        isError: false,
        result: {
          content: [
            {
              type: 'text',
              text: 'Tool call was blocked by workspace policy.',
            },
          ],
          details: {
            status: 'blocked',
            reason: 'workspace_policy',
            command: 'create',
            path: 'App.jsx',
          },
        },
      }),
    );

    expect(status).toEqual({
      status: 'error',
      errorMessage: 'Tool call was blocked by workspace policy.',
    });
  });

  it('marks nested blocked tool results as error even when the tool call itself succeeded', () => {
    const status = toolExecutionStatusForStream(
      toolEnd({
        toolName: 'str_replace_based_edit_tool',
        isError: false,
        result: {
          content: [{ type: 'text', text: 'Tool call was blocked by workspace policy.' }],
          details: {
            command: 'create',
            path: 'App.jsx',
            result: { blocked: true, reason: 'workspace_policy' },
          },
        },
      }),
    );

    expect(status.status).toBe('error');
    expect(status.errorMessage).toContain('workspace policy');
  });
});

describe('summarizeToolResultForStream', () => {
  it('summarizes loaded skill bodies for the chat stream', () => {
    const summarized = summarizeToolResultForStream('skill', {
      content: [{ type: 'text', text: `# huge skill body\n${'x'.repeat(20_000)}` }],
      details: {
        name: 'frontend-design-anti-slop',
        status: 'loaded',
        description: 'Creates distinctive, production-grade frontend interfaces.',
      },
    }) as { content?: Array<{ type?: string; text?: string }> };

    expect(summarized.content).toEqual([
      {
        type: 'text',
        text: 'Loaded skill frontend-design-anti-slop: Creates distinctive, production-grade frontend interfaces.',
      },
    ]);
  });

  it('caps oversized non-skill tool text while preserving generic details', () => {
    const summarized = summarizeToolResultForStream('inspect_workspace', {
      content: [{ type: 'text', text: 'x'.repeat(9000) }],
      details: { foo: 'bar' },
    }) as { content?: Array<{ type?: string; text?: string }>; details?: { foo?: string } };

    expect(summarized.content?.[0]?.text?.length ?? 0).toBeLessThanOrEqual(8 * 1024);
    expect(summarized.details?.foo).toBe('bar');
  });

  it('strips preview screenshots and caps preview detail arrays for history', () => {
    const compacted = compactToolResultForHistory('preview', {
      content: [{ type: 'text', text: 'preview ok' }],
      details: {
        ok: true,
        screenshot: `data:image/png;base64,${'x'.repeat(50_000)}`,
        domOutline: 'd'.repeat(10_000),
        consoleErrors: Array.from({ length: 20 }, (_, index) => ({
          level: 'error',
          message: `console ${index}`,
        })),
        assetErrors: Array.from({ length: 20 }, (_, index) => ({
          url: `https://cdn.example/${index}`,
          status: 404,
        })),
        metrics: { nodes: 10, width: 100, height: 100, loadMs: 50 },
      },
    }) as { details?: Record<string, unknown> };

    expect(compacted.details?.['screenshot']).toBe('[stripped for chat history]');
    expect((compacted.details?.['consoleErrors'] as unknown[])?.length).toBe(10);
    expect((compacted.details?.['assetErrors'] as unknown[])?.length).toBe(10);
    expect(String(compacted.details?.['domOutline']).length).toBeLessThan(2500);
  });

  it('compacts done details to a short structured summary', () => {
    const compacted = compactToolResultForHistory('done', {
      content: [{ type: 'text', text: `has_errors\n${'x'.repeat(20_000)}` }],
      details: {
        status: 'has_errors',
        path: 'App.jsx',
        errors: Array.from({ length: 12 }, (_, index) => ({
          message: `error ${index}`,
          source: 'syntax',
          lineno: index + 1,
        })),
        summary: 'repair me',
      },
    }) as { details?: Record<string, unknown>; content?: Array<{ text?: string }> };

    expect(compacted.content?.[0]?.text?.length ?? 0).toBeLessThanOrEqual(8 * 1024);
    expect(compacted.details).toMatchObject({
      status: 'has_errors',
      path: 'App.jsx',
      errorCount: 12,
      summary: 'repair me',
      summarized: true,
    });
    expect((compacted.details?.['errorsPreview'] as unknown[])?.length).toBe(6);
  });
});
