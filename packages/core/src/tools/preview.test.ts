import { Agent } from '@mariozechner/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getModel,
} from '@mariozechner/pi-ai';
import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ASSET_ERRORS,
  MAX_CONSOLE_ENTRIES,
  MAX_PREVIEW_STEPS,
  makePreviewTool,
  type PreviewInput,
  type PreviewResult,
  validatePreviewInput,
} from './preview.js';

function cannedResult(overrides: Partial<PreviewResult> = {}): PreviewResult {
  return {
    ok: true,
    consoleErrors: [],
    assetErrors: [],
    metrics: { nodes: 42, width: 1280, height: 800, loadMs: 120 },
    ...overrides,
  };
}

describe('makePreviewTool', () => {
  it('exposes the same fixed budget and fresh-journey recovery guidance in the tool and schema', () => {
    const tool = makePreviewTool(vi.fn());
    expect(MAX_PREVIEW_STEPS).toBe(16);
    expect(tool.parameters.properties.steps.maxItems).toBe(16);
    for (const description of [tool.description, tool.parameters.properties.steps.description]) {
      expect(description).toContain('16 steps per call');
      expect(description).toContain('every action AND assertion');
      expect(description).toContain('independent short journeys');
      expect(description).toContain('fresh document');
      expect(description).toContain('Repeat required setup');
      expect(description).toContain('Correct the arguments and retry');
      expect(description).toContain('do not blindly truncate');
      expect(description).toContain('untested remainder');
    }
  });

  it('rejects an oversized direct call without executing or truncating its steps', async () => {
    const runPreview = vi.fn();
    const params: PreviewInput = {
      path: 'App.jsx',
      steps: Array.from({ length: 17 }, () => ({
        action: 'assert',
        selector: '#confirmation',
        visible: true,
      })),
    };
    await expect(makePreviewTool(runPreview).execute('oversized', params)).rejects.toThrow(
      /Invalid preview input/,
    );
    expect(runPreview).not.toHaveBeenCalled();
    expect(params.steps).toHaveLength(17);
  });

  it('lets native pi reject 17 steps before execution and continue with a corrected 16-step call', async () => {
    const model = getModel('openai', 'gpt-4o-mini');
    const runPreview = vi.fn().mockResolvedValue(cannedResult());
    const tools = [makePreviewTool(runPreview)];
    const setup: NonNullable<PreviewInput['steps']> = Array.from({ length: 15 }, (_, index) =>
      index % 2 === 0
        ? { action: 'click', selector: '#next' }
        : { action: 'assert', selector: '#screen', visible: true, text: 'Booking' },
    );
    const oversized = [
      ...setup,
      { action: 'assert' as const, selector: '#confirmation', visible: true },
      { action: 'assert' as const, selector: '#confirmation', text: 'Booking confirmed' },
    ];
    const steps: NonNullable<PreviewInput['steps']> = [
      ...setup,
      { action: 'assert', selector: '#confirmation', visible: true, text: 'Booking confirmed' },
    ];
    const response = (content: AssistantMessage['content'], stopReason: 'toolUse' | 'stop') => {
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: 'done',
        reason: stopReason,
        message: {
          role: 'assistant',
          content,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason,
          timestamp: Date.now(),
        },
      });
      return stream;
    };
    let turns = 0;
    const observedErrors: string[] = [];
    const agent = new Agent({
      initialState: { model, tools },
      streamFn: async (_model, context) => {
        turns++;
        if (turns === 1) {
          return response(
            [
              {
                type: 'toolCall',
                id: 'too-long',
                name: 'preview',
                arguments: {
                  path: 'App.jsx',
                  viewport: { width: 1280, height: 1000 },
                  steps: oversized,
                },
              },
            ],
            'toolUse',
          );
        }
        if (turns === 2) {
          const error = context.messages.at(-1);
          if (error?.role !== 'toolResult' || !error.isError) {
            throw new Error('Expected recoverable preview validation tool result');
          }
          observedErrors.push(JSON.stringify(error.content));
          expect(runPreview).not.toHaveBeenCalled();
          return response(
            [
              {
                type: 'toolCall',
                id: 'corrected',
                name: 'preview',
                arguments: {
                  path: 'App.jsx',
                  viewport: { width: 1280, height: 1000 },
                  steps,
                },
              },
            ],
            'toolUse',
          );
        }
        if (turns !== 3) throw new Error('Unexpected retry loop');
        return response(
          [{ type: 'text', text: 'Checked the short journey; remaining paths are untested.' }],
          'stop',
        );
      },
    });
    await agent.prompt('Check a booking journey');
    expect(turns).toBe(3);
    expect(observedErrors[0]).toContain('Validation failed for tool');
    expect(observedErrors[0]).toContain('must not have more than 16 items');
    expect(runPreview).toHaveBeenCalledExactlyOnceWith({
      path: 'App.jsx',
      vision: false,
      viewport: { width: 1280, height: 1000 },
      steps,
      signal: expect.any(AbortSignal),
    });
    expect(oversized).toHaveLength(17);
    const results = agent.state.messages.filter((message) => message.role === 'toolResult');
    expect(results.map((result) => result.isError)).toEqual([true, false]);
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: 'Checked the short journey; remaining paths are untested.' }],
    });
  });

  it('returns the trimmed preview result verbatim on a clean run', async () => {
    const runPreview = vi.fn().mockResolvedValue(cannedResult());
    const tool = makePreviewTool(runPreview);

    const res = await tool.execute('call-1', { path: 'App.jsx' });

    expect(runPreview).toHaveBeenCalledWith({ path: 'App.jsx', vision: false });
    expect(res.details.ok).toBe(true);
    expect(res.details.metrics.nodes).toBe(42);
    expect(res.content[0]).toEqual({
      type: 'text',
      text: 'preview ok: 42 nodes, 0 console errors, 0 asset errors',
    });
  });

  it('forwards the vision capability from opts when params omit it', async () => {
    const runPreview = vi.fn().mockResolvedValue(cannedResult());
    const tool = makePreviewTool(runPreview, { vision: true });

    await tool.execute('call-1', { path: 'App.jsx' });

    expect(runPreview).toHaveBeenCalledWith({ path: 'App.jsx', vision: true });
  });

  it('returns preview screenshots as image tool-result content for vision models', async () => {
    const runPreview = vi.fn().mockResolvedValue(
      cannedResult({
        screenshot: 'data:image/png;base64,aW1n',
      }),
    );
    const tool = makePreviewTool(runPreview, { vision: true });

    const res = await tool.execute('call-1', { path: 'App.jsx' });

    expect(res.content).toEqual([
      {
        type: 'text',
        text: 'preview ok: 42 nodes, 0 console errors, 0 asset errors',
      },
      { type: 'image', mimeType: 'image/png', data: 'aW1n' },
    ]);
    expect(res.details.screenshot).toBe('data:image/png;base64,aW1n');
  });

  it('caps console and asset arrays to the documented budgets', async () => {
    const fatConsole = Array.from({ length: 100 }, (_, i) => ({
      level: 'error' as const,
      message: `err ${i}`,
    }));
    const fatAssets = Array.from({ length: 50 }, (_, i) => ({
      url: `https://example.com/${i}.png`,
      status: 404,
    }));
    const runPreview = vi.fn().mockResolvedValue(
      cannedResult({
        ok: false,
        consoleErrors: fatConsole,
        assetErrors: fatAssets,
        reason: 'boom',
      }),
    );
    const tool = makePreviewTool(runPreview);

    const res = await tool.execute('call-1', { path: 'index.html' });

    expect(res.details.consoleErrors).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(res.details.consoleErrors).toHaveLength(50);
    expect(res.details.assetErrors).toHaveLength(MAX_ASSET_ERRORS);
    expect(res.details.assetErrors).toHaveLength(20);
    expect(res.details.ok).toBe(false);
    expect(res.content[0]?.type).toBe('text');
  });

  it('throws a tool error when the executor throws', async () => {
    const cause = new Error('iframe crashed');
    const runPreview = vi.fn().mockRejectedValue(cause);
    const tool = makePreviewTool(runPreview);

    const err = await tool
      .execute('call-1', { path: 'index.html' })
      .catch((value: unknown) => value);
    expect(err).toBeInstanceOf(CodesignError);
    expect(err).toMatchObject({
      name: 'CodesignError',
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Preview executor failed: iframe crashed',
    });
    expect((err as CodesignError).cause).toBe(cause);
  });

  it('forwards viewport, ordered steps, and cancellation across the core boundary', async () => {
    const input: PreviewInput = {
      path: 'App.jsx',
      viewport: { width: 390, height: 844 },
      steps: [
        { action: 'fill', selector: '#new-task', value: 'Buy milk' },
        { action: 'press', selector: '#new-task', key: 'Enter' },
        { action: 'assert', selector: '#tasks', text: 'Buy milk', visible: true },
      ],
    };
    const signal = new AbortController().signal;
    const runPreview = vi.fn().mockResolvedValue(
      cannedResult({
        visibleText: 'Buy milk',
        domOutline: 'ul#tasks',
        steps: [{ index: 0, action: 'fill', selector: '#new-task', ok: true }],
      }),
    );
    const result = await makePreviewTool(runPreview).execute('call', input, signal);
    expect(runPreview).toHaveBeenCalledWith({ ...input, vision: false, signal });
    expect(result.content[1]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(result.content)).toContain('Buy milk');
    expect(JSON.stringify(result.content)).toContain('ul#tasks');
  });

  it.each([
    { viewport: { width: 239, height: 800 } },
    { viewport: { width: 2561, height: 800 } },
    { viewport: { width: 390, height: 1601 } },
    { viewport: { width: 390.5, height: 844 } },
    { steps: Array.from({ length: 17 }, () => ({ action: 'click', selector: '#x' })) },
    { steps: [{ action: 'click', selector: '' }] },
    { steps: [{ action: 'click', selector: 'x'.repeat(257) }] },
    { steps: [{ action: 'fill', selector: '#x', value: 'x'.repeat(2001) }] },
    { steps: [{ action: 'select', selector: '#x', value: 'x'.repeat(2001) }] },
    { steps: [{ action: 'select', selector: '#x' }] },
    { steps: [{ action: 'select', selector: '#x', value: ['work'] }] },
    { steps: [{ action: 'select', selector: '#x', value: 'work', label: 'Work' }] },
    { steps: [{ action: 'press', selector: '#x', key: 'F12' }] },
    { steps: [{ action: 'press', selector: '#x', key: 'ArrowDown' }] },
    { steps: [{ action: 'press', selector: '#x', key: 'End' }] },
    { steps: [{ action: 'assert', selector: '#x' }] },
    { steps: [{ action: 'assert', selector: '#x', text: '' }] },
    { steps: [{ action: 'click', selector: '#x', script: 'alert(1)' }] },
  ])('rejects invalid bounded input %j', (input) => {
    expect(() => validatePreviewInput({ path: 'App.jsx', ...input })).toThrow(
      /Invalid preview input/,
    );
  });

  it('accepts viewport limits, sixteen steps, and absence assertions', () => {
    for (const viewport of [
      { width: 240, height: 240 },
      { width: 2560, height: 1600 },
    ]) {
      expect(() =>
        validatePreviewInput({
          path: 'App.jsx',
          viewport,
          steps: Array.from({ length: 16 }, () => ({
            action: 'assert',
            selector: '#x',
            visible: false,
          })),
        }),
      ).not.toThrow();
    }
  });

  it('reports recovered cleanup warnings without calling the artifact broken', async () => {
    const runPreview = vi.fn().mockResolvedValue(
      cannedResult({
        warnings: ['Graceful shutdown timed out; isolated browser terminated'],
      }),
    );
    const result = await makePreviewTool(runPreview).execute('call', { path: 'App.jsx' });
    expect(result.details.ok).toBe(true);
    expect(JSON.stringify(result.content)).toContain('isolated browser terminated');
  });

  it('propagates select steps and accepts empty and maximum-length option values', async () => {
    const input: PreviewInput = {
      path: 'App.jsx',
      steps: [
        { action: 'select', selector: '#category', value: 'work' },
        { action: 'select', selector: '#category', value: '' },
        { action: 'select', selector: '#category', value: 'x'.repeat(2000) },
      ],
    };
    const runPreview = vi.fn().mockResolvedValue(cannedResult());
    await makePreviewTool(runPreview).execute('call', input);
    expect(runPreview).toHaveBeenCalledWith({ ...input, vision: false });
  });
});
