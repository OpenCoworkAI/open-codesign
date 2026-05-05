import type { ChatToolCallPayload } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildActivityRows } from '../WorkingCard';

function call(
  p: Partial<ChatToolCallPayload> & Pick<ChatToolCallPayload, 'toolName'>,
): ChatToolCallPayload {
  return {
    args: {},
    status: 'done',
    startedAt: '2026-04-20T00:00:00.000Z',
    verbGroup: 'Working',
    ...p,
  };
}

describe('WorkingCard.buildActivityRows', () => {
  it('merges consecutive str_replace edits to the same path into one row', () => {
    const calls = [
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
      }),
    ];
    const rows = buildActivityRows(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBe('index.html');
    expect(rows[0]?.editCount).toBe(3);
    expect(rows[0]?.label).toBe('Edited file');
  });

  it('merges legacy text-editor calls without command field', () => {
    // Old session chat rows persisted before `command` was plumbed.
    const calls = [
      call({ toolName: 'str_replace_based_edit_tool', args: { path: 'index.html' } }),
      call({ toolName: 'str_replace_based_edit_tool', args: { path: 'index.html' } }),
      call({ toolName: 'str_replace_based_edit_tool', args: { path: 'index.html' } }),
    ];
    const rows = buildActivityRows(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.editCount).toBe(3);
    // Should not leak the verbose tool name into the label.
    expect(rows[0]?.label).toBe('Edited file');
  });

  it('keeps the merge run across an in-between set_todos call', () => {
    const calls = [
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
      }),
      call({
        toolName: 'set_todos',
        args: { items: [{ text: 'wrap header', checked: true }] },
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
      }),
    ];
    const rows = buildActivityRows(calls);
    // 1 merged edit row + 1 todos row.
    expect(rows).toHaveLength(2);
    const editRow = rows.find((r) => r.detail === 'index.html');
    expect(editRow?.editCount).toBe(2);
  });

  it('keeps separate rows for different paths', () => {
    const calls = [
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'a.html' },
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'b.html' },
      }),
    ];
    const rows = buildActivityRows(calls);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.detail)).toEqual(['a.html', 'b.html']);
  });

  it('keeps create plus later edits visible as one file lifecycle row', () => {
    const rows = buildActivityRows([
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'create',
        args: { path: 'DESIGN.md' },
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'DESIGN.md' },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Created and edited');
    expect(rows[0]?.detail).toBe('DESIGN.md');
    expect(rows[0]?.editCount).toBe(2);
  });

  it('falls back to result details for older file rows without start args', () => {
    const rows = buildActivityRows([
      call({
        toolName: 'str_replace_based_edit_tool',
        result: {
          content: [{ type: 'text', text: 'Created DESIGN.md' }],
          details: { command: 'create', path: 'DESIGN.md', result: { path: 'DESIGN.md' } },
        },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Created file');
    expect(rows[0]?.detail).toBe('DESIGN.md');
  });

  it('renders host workspace memory updates as visible file activity', () => {
    const rows = buildActivityRows([
      call({
        toolName: 'workspace_memory',
        command: 'update',
        args: { path: 'MEMORY.md' },
        durationMs: 1400,
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Updated memory');
    expect(rows[0]?.detail).toBe('MEMORY.md');
    expect(rows[0]?.durationMs).toBe(1400);
  });

  it('aggregates consecutive skill calls into one design-rules row', () => {
    const rows = buildActivityRows([
      call({ toolName: 'skill', args: { name: 'accessibility-states' } }),
      call({ toolName: 'skill', args: { name: 'surface-elevation' } }),
      call({ toolName: 'skill', args: { name: 'cjk-typography' } }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Loaded design rules');
    expect(rows[0]?.detail).toBe('accessibility-states · surface-elevation · cjk-typography');
    expect(rows[0]?.title).toContain('accessibility-states, surface-elevation, cjk-typography');
  });

  it('truncates long skill aggregates while keeping the full list in the title', () => {
    const rows = buildActivityRows([
      call({ toolName: 'skill', args: { name: 'a' } }),
      call({ toolName: 'skill', args: { name: 'b' } }),
      call({ toolName: 'skill', args: { name: 'c' } }),
      call({ toolName: 'skill', args: { name: 'd' } }),
      call({ toolName: 'skill', args: { name: 'e' } }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBe('a · b · c +2');
    expect(rows[0]?.title).toContain('a, b, c, d, e');
  });

  it('uses the latest same-file edit status for the merged row', () => {
    const calls = [
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
        status: 'done',
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
        status: 'running',
      }),
    ];
    const rows = buildActivityRows(calls);
    expect(rows[0]?.status).toBe('running');

    const settledRows = buildActivityRows([
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
        status: 'running',
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'str_replace',
        args: { path: 'index.html' },
        status: 'done',
      }),
    ]);
    expect(settledRows[0]?.status).toBe('done');
  });

  it('renders blocked creates as their own error row instead of merging into later edits', () => {
    const rows = buildActivityRows([
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'create',
        args: { path: 'App.jsx' },
        status: 'error',
        result: {
          content: [{ type: 'text', text: 'Tool call was blocked by workspace policy.' }],
          details: { status: 'blocked', reason: 'workspace_policy' },
        },
      }),
      call({
        toolName: 'set_todos',
        args: { items: [{ text: 'Build page', checked: false }] },
      }),
      call({
        toolName: 'str_replace_based_edit_tool',
        command: 'create',
        args: { path: 'App.jsx' },
        status: 'done',
      }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.label).toBe('Created file');
    expect(rows[0]?.status).toBe('error');
    expect(rows[0]?.detail).toBe('App.jsx');
    expect(rows[2]?.label).toBe('Created file');
    expect(rows[2]?.status).toBe('done');
  });

  it('does not expose successful skill bodies as row hover text', () => {
    const rows = buildActivityRows([
      call({
        toolName: 'skill',
        args: { name: 'pitch-deck' },
        status: 'done',
        result: {
          content: [
            {
              type: 'text',
              text: '---\nschemaVersion: 1\nname: pitch-deck\n---\n\n## Pitch Deck Design Principles',
            },
          ],
          details: { name: 'pitch-deck', status: 'loaded' },
        },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Loaded design rules');
    expect(rows[0]?.detail).toBe('pitch-deck');
    expect(rows[0]?.errorText).toBeUndefined();
  });

  it('demotes removed helper tools to a generic legacy row', () => {
    const rows = buildActivityRows([
      call({ toolName: 'read_url', args: { url: 'https://example.com' } }),
      call({ toolName: 'text_editor', command: 'str_replace', args: { path: 'index.html' } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.label)).toEqual(['Legacy tool', 'Legacy tool']);
    expect(rows.map((row) => row.detail)).toEqual(['https://example.com', 'index.html']);
  });

  it('hides successful title and done calls but shows failures', () => {
    const rows = buildActivityRows([
      call({ toolName: 'set_title', status: 'done', args: { title: 'Dashboard' } }),
      call({ toolName: 'done', status: 'done', args: { path: 'App.jsx' } }),
      call({
        toolName: 'set_title',
        status: 'error',
        args: { title: 'Dashboard' },
        error: { message: 'no title' },
      }),
      call({
        toolName: 'done',
        status: 'error',
        args: { path: 'App.jsx' },
        error: { message: 'preview failed' },
      }),
    ]);

    expect(rows.map((row) => row.label)).toEqual(['Title update failed', 'Final check failed']);
  });
});
