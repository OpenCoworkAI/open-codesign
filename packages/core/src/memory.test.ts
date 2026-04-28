import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { describe, expect, it } from 'vitest';
import {
  extractSummaryFromMemory,
  formatGlobalMemoryIndex,
  formatMemoryForContext,
  type GlobalMemoryEntry,
  parseGlobalMemoryIndex,
  serializeMessagesForMemory,
} from './memory.js';

function userMsg(text: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

function assistantMsg(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

function toolResultMsg(text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: 't1',
    content: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

describe('serializeMessagesForMemory', () => {
  it('serializes user and assistant messages', () => {
    const messages = [userMsg('hello'), assistantMsg('world')];
    const result = serializeMessagesForMemory(messages);
    expect(result).toContain('[user]\nhello');
    expect(result).toContain('[assistant]\nworld');
  });

  it('truncates tool results to 500 chars', () => {
    const longResult = 'x'.repeat(1000);
    const messages = [toolResultMsg(longResult)];
    const result = serializeMessagesForMemory(messages);
    expect(result).toContain('[tool_result]');
    expect(result).toContain('…[truncated]');
    expect(result.length).toBeLessThan(1000);
  });

  it('keeps tool results under 500 chars intact', () => {
    const shortResult = 'short result';
    const messages = [toolResultMsg(shortResult)];
    const result = serializeMessagesForMemory(messages);
    expect(result).toContain(shortResult);
    expect(result).not.toContain('[truncated]');
  });

  it('truncates from oldest when exceeding 100KB limit', () => {
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 200; i++) {
      messages.push(userMsg(`message ${i}: ${'x'.repeat(600)}`));
    }
    const result = serializeMessagesForMemory(messages);
    expect(result.length).toBeLessThanOrEqual(100_000 + 100);
    expect(result).toContain('[…earlier messages truncated…]');
    expect(result).toContain('message 199');
  });

  it('returns empty string for empty messages', () => {
    expect(serializeMessagesForMemory([])).toBe('');
  });
});

describe('formatMemoryForContext', () => {
  it('returns empty array when both inputs are null', () => {
    expect(formatMemoryForContext(null, null)).toEqual([]);
  });

  it('wraps design memory in untrusted tags', () => {
    const sections = formatMemoryForContext('# My Memory', null);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('<untrusted_scanned_content type="project_memory">');
    expect(sections[0]).toContain('# My Memory');
    expect(sections[0]).toContain('</untrusted_scanned_content>');
  });

  it('wraps global index in untrusted tags', () => {
    const sections = formatMemoryForContext(null, 'abc|Test|Summary');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('<untrusted_scanned_content type="global_project_index">');
    expect(sections[0]).toContain('abc|Test|Summary');
  });

  it('returns both sections when both present', () => {
    const sections = formatMemoryForContext('# Memory', 'abc|Test|Summary');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('global_project_index');
    expect(sections[1]).toContain('project_memory');
  });

  it('skips whitespace-only inputs', () => {
    expect(formatMemoryForContext('  \n  ', '   ')).toEqual([]);
  });
});

describe('formatGlobalMemoryIndex', () => {
  it('returns frontmatter only for empty entries', () => {
    const result = formatGlobalMemoryIndex([]);
    expect(result).toContain('schemaVersion: 1');
    expect(result.trim()).toBe('---\nschemaVersion: 1\n---');
  });

  it('formats entries as id|name|summary', () => {
    const entries: GlobalMemoryEntry[] = [
      { designId: 'abc-123-xyz', designName: 'Dashboard', summary: 'Dark SaaS UI' },
    ];
    const result = formatGlobalMemoryIndex(entries);
    expect(result).toContain('abc-123-');
    expect(result).toContain('Dashboard');
    expect(result).toContain('Dark SaaS UI');
  });

  it('caps total body at 200 characters', () => {
    const entries: GlobalMemoryEntry[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push({
        designId: `id-${i.toString().padStart(4, '0')}-padding`,
        designName: `Design Number ${i}`,
        summary: `This is a summary for design ${i}`,
      });
    }
    const result = formatGlobalMemoryIndex(entries);
    const body = result.replace(/^---[\s\S]*?---\n?/, '');
    expect(body.length).toBeLessThanOrEqual(201);
  });

  it('truncates long design IDs and names', () => {
    const entries: GlobalMemoryEntry[] = [
      {
        designId: 'a'.repeat(50),
        designName: 'b'.repeat(50),
        summary: 'c'.repeat(50),
      },
    ];
    const result = formatGlobalMemoryIndex(entries);
    const body = result.replace(/^---[\s\S]*?---\n?/, '').trim();
    const parts = body.split('|');
    expect(parts[0]?.length).toBeLessThanOrEqual(8);
    expect(parts[1]?.length).toBeLessThanOrEqual(30);
    expect(parts[2]?.length).toBeLessThanOrEqual(40);
  });
});

describe('parseGlobalMemoryIndex', () => {
  it('parses formatted index back into entries', () => {
    const raw = '---\nschemaVersion: 1\n---\nabc|Dashboard|Dark SaaS\ndef|Landing|Hero page\n';
    const entries = parseGlobalMemoryIndex(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ designId: 'abc', designName: 'Dashboard', summary: 'Dark SaaS' });
    expect(entries[1]).toEqual({ designId: 'def', designName: 'Landing', summary: 'Hero page' });
  });

  it('skips malformed lines', () => {
    const raw = '---\nschemaVersion: 1\n---\nabc|Dashboard|Dark\nbadline\ndef|Landing|Hero\n';
    const entries = parseGlobalMemoryIndex(raw);
    expect(entries).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(parseGlobalMemoryIndex('')).toEqual([]);
    expect(parseGlobalMemoryIndex('---\nschemaVersion: 1\n---')).toEqual([]);
  });

  it('preserves pipe characters in summary', () => {
    const raw = '---\nschemaVersion: 1\n---\nabc|Test|sum|with|pipes\n';
    const entries = parseGlobalMemoryIndex(raw);
    expect(entries[0]?.summary).toBe('sum|with|pipes');
  });
});

describe('extractSummaryFromMemory', () => {
  it('extracts Purpose line', () => {
    const memory = [
      '# Project Memory',
      '## Overview',
      '- Purpose: Fintech dashboard for startup pitch',
      '- Style: Dark glassmorphism',
    ].join('\n');
    expect(extractSummaryFromMemory(memory)).toBe('Fintech dashboard for startup pitch');
  });

  it('falls back to Style when Purpose is missing', () => {
    const memory = ['## Overview', '- Style: Modern minimalist with pastels'].join('\n');
    expect(extractSummaryFromMemory(memory)).toBe('Modern minimalist with pastels');
  });

  it('returns empty string when no match', () => {
    expect(extractSummaryFromMemory('# Nothing useful here')).toBe('');
  });

  it('truncates summary to 40 characters', () => {
    const memory = `- Purpose: ${'x'.repeat(60)}`;
    expect(extractSummaryFromMemory(memory).length).toBeLessThanOrEqual(40);
  });
});

describe('roundtrip: formatGlobalMemoryIndex → parseGlobalMemoryIndex', () => {
  it('roundtrips entries correctly', () => {
    const entries: GlobalMemoryEntry[] = [
      { designId: 'id1', designName: 'Design One', summary: 'First project' },
      { designId: 'id2', designName: 'Design Two', summary: 'Second project' },
    ];
    const formatted = formatGlobalMemoryIndex(entries);
    const parsed = parseGlobalMemoryIndex(formatted);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.designName).toBe('Design One');
    expect(parsed[1]?.summary).toBe('Second project');
  });
});
