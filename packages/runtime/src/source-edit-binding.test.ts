import type { SourceEditOperation, SourceEditTextLayout } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { bindSourceEditFields } from './source-edit-binding';

type Child = string | { id?: string; comment?: string };
function host(
  children: Child[],
  attributes: Record<string, string> = {},
  styleValues: Record<string, string> = {},
): Element {
  function style(values: Record<string, string>) {
    return {
      getPropertyValue: (name: string) => values[name] ?? '',
      setProperty: (name: string, value: string) => {
        values[name] = value;
      },
    };
  }
  return {
    childNodes: children.map((child) =>
      typeof child === 'string'
        ? { nodeType: 3, textContent: child }
        : child.comment !== undefined
          ? { nodeType: 8, textContent: child.comment }
          : { nodeType: 1, getAttribute: () => (child.id ? `rev:${child.id}` : null) },
    ),
    getAttribute: (name: string) => attributes[name] ?? null,
    style: style(styleValues),
    ownerDocument: { createElement: () => ({ style: style({}) }) },
  } as unknown as Element;
}
function text(value: string, textId = '1:2'): SourceEditTextLayout[number] {
  return { kind: 'text', value, textId };
}
function operation(value: string, textId = '1:2'): SourceEditOperation {
  return { kind: 'set-text', value, textId };
}
const dynamic = { kind: 'dynamic' } as const;
function states(
  children: Child[],
  textLayout: SourceEditTextLayout,
  fields: SourceEditOperation[],
) {
  return bindSourceEditFields(host(children), { textLayout, editableFields: fields }, 'rev');
}

describe('field-level source-definition DOM binding', () => {
  it('binds static prefixes and suffixes around changing dynamic content', () => {
    const layout = [text('Cart ('), dynamic, text(')', '3:4')];
    const fields = [operation('Cart ('), operation(')', '3:4')];
    for (const count of ['0', '32', '']) {
      expect(states(['Cart (', count, ')'], layout, fields).map((s) => s.status)).toEqual([
        'ready',
        'ready',
      ]);
    }
  });
  it('supports an opaque icon element without flattening its descendants', () => {
    expect(
      states([{}, 'Download'], [dynamic, text('Download')], [operation('Download')])[0]?.status,
    ).toBe('ready');
    expect(states([{}], [text('Download')], [operation('Download')])[0]?.status).toBe('changed');
  });
  it('preserves marked native sibling boundaries, comments and adjacent text nodes', () => {
    const layout = [
      text('Hello'),
      { kind: 'element' as const, targetId: '10:20' },
      text('world', '3:4'),
    ];
    expect(
      states(['Hello', { comment: 'React' }, { id: '10:20' }, 'world'], layout, [
        operation('Hello'),
        operation('world', '3:4'),
      ]).map((s) => s.status),
    ).toEqual(['ready', 'ready']);
    expect(states(['Helloworld'], layout, [operation('Hello')])[0]?.status).toBe('changed');
  });
  it('does not let a dynamic slot swallow an authored native sibling', () => {
    expect(
      states(
        [{ id: '10:20' }, 'Name'],
        [dynamic, text('Name'), { kind: 'element', targetId: '10:20' }],
        [operation('Name')],
      )[0]?.status,
    ).toBe('changed');
  });
  it('keeps uniquely anchored fields while refusing only ambiguous fields', () => {
    const result = states(
      ['Prefix', 'X', '--', 'X'],
      [text('Prefix'), dynamic, text('X', '3:4'), dynamic],
      [operation('Prefix'), operation('X', '3:4')],
    );
    expect(result.map((s) => s.status)).toEqual(['ready', 'ambiguous']);
  });
  it('can independently bind a prefix after an unrelated sibling changed', () => {
    expect(
      states(
        ['Prefix', 'unknown', 'replaced'],
        [text('Prefix'), dynamic, text('Suffix', '3:4')],
        [operation('Prefix'), operation('Suffix', '3:4')],
      ).map((s) => s.status),
    ).toEqual(['ready', 'changed']);
  });
  it('refuses changed static content and never trims or normalizes user text', () => {
    for (const actual of ['Changed', ' Hello', 'Hello ', 'hello']) {
      expect(states([actual], [text('Hello')], [operation('Hello')])[0]?.status).toBe('changed');
    }
  });
  it('refuses deleted duplicate definitions and surviving sibling substrings', () => {
    for (const [left, right, actual] of [
      ['A', 'A', 'A'],
      ['A', 'AB', 'AB'],
    ]) {
      if (left === undefined || right === undefined || actual === undefined)
        throw new Error('Missing fixture');
      expect(
        states(
          [actual],
          [text(left), text(right, '3:4')],
          [operation(left), operation(right, '3:4')],
        ).map((s) => s.status),
      ).toEqual(['changed', 'changed']);
    }
    expect(states(['PrefixA'], [dynamic, text('A')], [operation('A')])[0]?.status).toBe('changed');
    expect(states(['He', 'llo'], [text('Hello')], [operation('Hello')])[0]?.status).toBe('changed');
  });
  it('does not confuse a literal NUL with an element boundary', () => {
    expect(states([{}], [text('\0')], [operation('\0')])[0]?.status).toBe('changed');
    expect(states(['\0'], [text('\0')], [operation('\0')])[0]?.status).toBe('ready');
  });
  it('binds attributes and inline properties independently of changed text', () => {
    const result = bindSourceEditFields(
      host(['Changed'], { title: 'Tooltip' }, { gap: '12px', color: 'red' }),
      {
        textLayout: [text('Original')],
        editableFields: [
          operation('Original'),
          { kind: 'set-attribute', name: 'title', value: 'Tooltip' },
          { kind: 'set-style', property: 'gap', value: '12' },
          { kind: 'set-style', property: 'color', value: 'blue' },
        ],
      },
      'rev',
    );
    expect(result.map((s) => s.status)).toEqual(['changed', 'ready', 'ready', 'changed']);
  });
  it('does not bind a field missing from the inspected text layout', () => {
    expect(states(['Hello'], [dynamic], [operation('Hello')])[0]?.status).toBe('changed');
  });
  it('supports a sole legacy text field without an explicit segment id', () => {
    expect(
      states(['Hello'], [{ kind: 'text', value: 'Hello' }], [{ kind: 'set-text', value: 'Hello' }]),
    ).toEqual([{ key: 'text:only', status: 'ready' }]);
  });
  it('fails closed on excessive text, layout and matching work', () => {
    expect(states(['a'.repeat(50_001)], [dynamic, text('a')], [operation('a')])[0]?.status).toBe(
      'unmapped',
    );
    expect(
      states(
        ['x'],
        Array.from({ length: 257 }, () => dynamic),
        [operation('x')],
      )[0]?.status,
    ).toBe('unmapped');
    const result = states(
      Array.from({ length: 1024 }, () => 'x'),
      [dynamic, text(''), dynamic, text('absent', '3:4')],
      [operation(''), operation('absent', '3:4')],
    );
    expect(result.every((s) => s.status === 'unmapped')).toBe(true);
  });
});
