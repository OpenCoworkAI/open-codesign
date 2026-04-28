import type { ChatToolCallPayload } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildRows } from '../WorkingCard';

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

describe('WorkingCard.buildRows', () => {
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
    const rows = buildRows(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBe('index.html');
    expect(rows[0]?.editCount).toBe(3);
    expect(rows[0]?.label).toBe('edit');
  });

  it('merges legacy text-editor calls without command field', () => {
    // Old chat_messages rows persisted before `command` was plumbed.
    const calls = [
      call({ toolName: 'str_replace_based_edit_tool', args: { path: 'index.html' } }),
      call({ toolName: 'str_replace_based_edit_tool', args: { path: 'index.html' } }),
      call({ toolName: 'str_replace_based_edit_tool', args: { path: 'index.html' } }),
    ];
    const rows = buildRows(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.editCount).toBe(3);
    // Should not leak the verbose tool name into the label.
    expect(rows[0]?.label).toBe('edit');
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
    const rows = buildRows(calls);
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
    const rows = buildRows(calls);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.detail)).toEqual(['a.html', 'b.html']);
  });

  it('promotes any running edit status to the merged row', () => {
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
    const rows = buildRows(calls);
    expect(rows[0]?.status).toBe('running');
  });

  it('demotes removed helper tools to a generic legacy row', () => {
    const rows = buildRows([
      call({ toolName: 'read_url', args: { url: 'https://example.com' } }),
      call({ toolName: 'text_editor', command: 'str_replace', args: { path: 'index.html' } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.label)).toEqual(['legacy tool', 'legacy tool']);
    expect(rows.map((row) => row.detail)).toEqual(['https://example.com', 'index.html']);
  });
});
