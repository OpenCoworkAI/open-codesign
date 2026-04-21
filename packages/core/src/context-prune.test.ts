import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { describe, expect, it } from 'vitest';
import { buildTransformContext } from './context-prune.js';

function userMsg(text: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

function assistantWithToolCall(toolCallId: string, inputArg: string): AgentMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'ok' },
      {
        type: 'toolCall',
        id: toolCallId,
        name: 'str_replace_based_edit_tool',
        input: { inputArg },
      },
    ],
  } as unknown as AgentMessage;
}

function toolResult(toolCallId: string, body: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    content: [{ type: 'text', text: body }],
  } as unknown as AgentMessage;
}

function assistantText(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

describe('buildTransformContext — size-based block compaction with recent-turn window', () => {
  it('is a no-op when every block is under its cap', async () => {
    const transform = buildTransformContext();
    const messages: AgentMessage[] = [
      userMsg('hi'),
      assistantWithToolCall('t1', 'small'),
      toolResult('t1', 'small result'),
      assistantText('done'),
    ];
    const out = await transform(messages);
    expect(out).toEqual(messages);
  });

  it('stubs a large assistant text block even on the LATEST message', async () => {
    // Text cap applies to ALL turns. Guards against the `<artifact>` text
    // dump regression (assistant streamed 9 MB JSX as prose on the final turn).
    const transform = buildTransformContext();
    const huge = 'x'.repeat(50_000);
    const messages: AgentMessage[] = [userMsg('build it'), assistantText(huge)];
    const out = await transform(messages);
    const last = out[out.length - 1] as { content: Array<{ text?: string }> };
    const text = last.content[0]?.text ?? '';
    expect(text.startsWith('[prior assistant output dropped')).toBe(true);
    expect(text).toContain('50000B');
  });

  it('keeps a large toolCall.input verbatim inside the recent window', async () => {
    // The model's own just-written str_replace must stay full-fidelity so it
    // can pick the next old_str from memory instead of guessing.
    const transform = buildTransformContext();
    const bulk = 'a'.repeat(20_000);
    const messages: AgentMessage[] = [
      userMsg('build'),
      assistantWithToolCall('call-0', bulk),
      toolResult('call-0', 'ok'),
    ];
    const out = await transform(messages);
    const a = out[1] as {
      content: Array<{ type?: string; id?: string; input?: { inputArg?: string } }>;
    };
    const tc = a.content.find((c) => c.type === 'toolCall');
    expect(tc?.id).toBe('call-0');
    expect(tc?.input?.inputArg).toBe(bulk);
  });

  it('summarizes a large toolCall.input for older turns outside the window', async () => {
    const transform = buildTransformContext();
    const bulk = 'a'.repeat(30_000);
    const messages: AgentMessage[] = [userMsg('build')];
    messages.push(assistantWithToolCall('call-old', bulk));
    messages.push(toolResult('call-old', 'ok'));
    // Three more turns push call-old out of the 3-turn window.
    for (let i = 0; i < 3; i += 1) {
      messages.push(assistantWithToolCall(`t${i}`, 'small'));
      messages.push(toolResult(`t${i}`, 'ok'));
    }
    const out = await transform(messages);
    const oldAssistant = out[1] as {
      content: Array<{
        type?: string;
        id?: string;
        input?: { _summarized?: boolean; _origBytes?: number };
      }>;
    };
    const tc = oldAssistant.content.find((c) => c.type === 'toolCall');
    expect(tc?.id).toBe('call-old');
    expect(tc?.input?._summarized).toBe(true);
    expect(tc?.input?._origBytes ?? 0).toBeGreaterThan(20_000);
  });

  it('keeps a large toolResult verbatim inside the recent window', async () => {
    const transform = buildTransformContext();
    const bulk = 'y'.repeat(20_000);
    const messages: AgentMessage[] = [
      userMsg('x'),
      assistantWithToolCall('call-0', 'a'),
      toolResult('call-0', bulk),
    ];
    const out = await transform(messages);
    const tr = out[2] as { toolCallId?: string; content: Array<{ text?: string }> };
    expect(tr.toolCallId).toBe('call-0');
    expect(tr.content[0]?.text).toBe(bulk);
  });

  it('stubs large toolResult bodies for older turns outside the window', async () => {
    const transform = buildTransformContext();
    const bulk = 'y'.repeat(20_000);
    const messages: AgentMessage[] = [userMsg('x')];
    messages.push(assistantWithToolCall('call-old', 'a'));
    messages.push(toolResult('call-old', bulk));
    for (let i = 0; i < 3; i += 1) {
      messages.push(assistantWithToolCall(`t${i}`, 'small'));
      messages.push(toolResult(`t${i}`, 'ok'));
    }
    const out = await transform(messages);
    const tr = out[2] as { toolCallId?: string; content: Array<{ text?: string }> };
    expect(tr.toolCallId).toBe('call-old');
    expect(tr.content[0]?.text?.startsWith('[tool result dropped')).toBe(true);
  });

  it('leaves small blocks untouched regardless of position', async () => {
    const transform = buildTransformContext();
    const messages: AgentMessage[] = [userMsg('go')];
    for (let i = 0; i < 20; i += 1) {
      messages.push(assistantWithToolCall(`t${i}`, 'tiny'));
      messages.push(toolResult(`t${i}`, `tiny result ${i}`));
    }
    const out = await transform(messages);
    expect(out).toEqual(messages);
  });

  it('never modifies user messages', async () => {
    const transform = buildTransformContext();
    const opening = userMsg('x'.repeat(50_000));
    const messages: AgentMessage[] = [opening, assistantText('ok')];
    const out = await transform(messages);
    expect(out[0]).toBe(opening);
  });

  it('tightens to aggressive caps (ignoring window) when HARD_CAP_BYTES is exceeded', async () => {
    const transform = buildTransformContext();
    const messages: AgentMessage[] = [userMsg('go')];
    const midText = 'p'.repeat(6_000);
    for (let i = 0; i < 40; i += 1) {
      messages.push(assistantText(midText));
      messages.push(assistantWithToolCall(`t${i}`, 'p'.repeat(10_000)));
      messages.push(toolResult(`t${i}`, 'p'.repeat(10_000)));
    }
    const out = await transform(messages);
    let droppedTextCount = 0;
    for (const m of out) {
      if (m.role !== 'assistant') continue;
      const content = (m as { content: Array<{ type?: string; text?: string }> }).content;
      for (const c of content) {
        if (c.type === 'text' && c.text?.startsWith('[prior assistant output dropped')) {
          droppedTextCount += 1;
        }
      }
    }
    expect(droppedTextCount).toBeGreaterThanOrEqual(35);
  });
});
