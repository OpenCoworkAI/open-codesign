import type { SourceEditOperation, SourceEditTextLayout } from '@open-codesign/shared';

export interface SourceEditFieldState {
  key: string;
  status: 'ready' | 'changed' | 'ambiguous' | 'unmapped';
  message?: string;
}
export interface SourceEditBindingPlan {
  textLayout: SourceEditTextLayout;
  editableFields: SourceEditOperation[];
}
interface BindingStyle {
  getPropertyValue(name: string): string;
  setProperty(name: string, value: string): void;
}
interface BindingNode {
  nodeType: number;
  textContent: string | null;
  getAttribute?: (name: string) => string | null;
}
// Structural types keep this module importable by the no-DOM main-process compiler.
export interface SourceEditBindingHost {
  childNodes: ArrayLike<BindingNode>;
  getAttribute(name: string): string | null;
  style?: BindingStyle;
  ownerDocument: { createElement(tag: string): { style: BindingStyle } };
}

// Self-contained: this exact function also runs inside the isolated preview.
// React's scalar children own Text nodes. Never discard their boundaries and
// mistake a surviving dynamic/sibling substring for a removed definition.
export function bindSourceEditFields(
  host: SourceEditBindingHost,
  plan: SourceEditBindingPlan,
  previewRevision: string,
  bindNode?: (key: string, node: BindingNode | null) => void,
): SourceEditFieldState[] {
  function fieldKey(field: SourceEditOperation): string {
    if (field.kind === 'set-text') return `text:${field.textId ?? 'only'}`;
    return field.kind === 'set-attribute' ? `attribute:${field.name}` : `style:${field.property}`;
  }
  const fields = plan.editableFields.slice(0, 512);
  const states: SourceEditFieldState[] = fields.map((field) => ({
    key: fieldKey(field),
    status: 'unmapped',
  }));
  const textStates = states.filter((_, index) => fields[index]?.kind === 'set-text');
  const observed: (string | { id: string | null })[] = [];
  const nodes: BindingNode[] = [];
  const bindings = new Map<string, BindingNode | null>();
  let textLength = 0;
  const prefix = `${previewRevision}:`;
  let bounded =
    plan.textLayout.length <= 256 && fields.length <= 128 && host.childNodes.length <= 1024;
  if (bounded && textStates.length) {
    for (const child of Array.from(host.childNodes)) {
      if (child.nodeType === 3) {
        const value = child.textContent ?? '';
        if (value) {
          observed.push(value);
          nodes.push(child);
        }
        textLength += value.length;
      } else if (child.nodeType === 1) {
        const marker = child.getAttribute?.('data-codesign-source-id');
        observed.push({ id: marker?.startsWith(prefix) ? marker.slice(prefix.length) : null });
        nodes.push(child);
      }
      if (textLength > 50_000) {
        bounded = false;
        break;
      }
    }
  }
  const anchorIds = new Set(
    plan.textLayout.flatMap((part) => (part.kind === 'element' ? [part.targetId] : [])),
  );
  const anchorPositions = observed.flatMap((part, index) =>
    typeof part !== 'string' && part.id !== null && anchorIds.has(part.id) ? [index] : [],
  );
  type MatchToken = SourceEditTextLayout[number] | { kind: 'text-slot'; empty: boolean };
  let budget = 30_000;
  function match(layout: MatchToken[], wanted: string[]): Map<string, Set<string>> {
    const tokens: MatchToken[] = [];
    for (const part of layout) {
      if (part.kind !== 'dynamic' || tokens.at(-1)?.kind !== 'dynamic') tokens.push(part);
    }
    const ranges = new Map(wanted.map((key) => [key, new Set<string>()]));
    const captures = new Map<string, string>();
    function visit(index: number, position: number): void {
      if (--budget < 0 || position > observed.length) return;
      if (wanted.every((key) => (ranges.get(key)?.size ?? 0) > 1)) return;
      const token = tokens[index];
      if (!token) {
        if (position === observed.length)
          for (const key of wanted) {
            const range = captures.get(key);
            if (range !== undefined) ranges.get(key)?.add(range);
          }
        return;
      }
      const actual = observed[position];
      if (token.kind === 'text') {
        if (token.value !== '' && actual !== token.value) return;
        const end = position + (token.value === '' ? 0 : 1);
        const key = `text:${token.textId ?? 'only'}`;
        captures.set(key, `${position}:${end}`);
        visit(index + 1, end);
        captures.delete(key);
      } else if (token.kind === 'text-slot') {
        if (token.empty || typeof actual === 'string')
          visit(index + 1, position + (token.empty ? 0 : 1));
      } else if (token.kind === 'element') {
        if (typeof actual === 'object' && actual.id === token.targetId)
          visit(index + 1, position + 1);
      } else {
        // Dynamic children cannot consume explicitly owned native siblings.
        const last = anchorPositions.find((at) => at >= position) ?? observed.length;
        if (!tokens[index + 1]) {
          if (last === observed.length) visit(index + 1, observed.length);
        } else {
          for (let at = position; at <= last && budget >= 0; at++) visit(index + 1, at);
        }
      }
    }
    visit(0, 0);
    return ranges;
  }
  if (bounded && textStates.length) {
    const ranges = match(
      plan.textLayout,
      textStates.map((state) => state.key),
    );
    for (const state of textStates) {
      let found = ranges.get(state.key);
      if (!found?.size && budget >= 0) {
        // A changed sibling must still occupy its scalar Text slot, not an
        // arbitrary wildcard that lets two absent definitions reuse one node.
        const independent: MatchToken[] = plan.textLayout.map((part) =>
          part.kind === 'text' && `text:${part.textId ?? 'only'}` !== state.key
            ? { kind: 'text-slot', empty: part.value === '' }
            : part,
        );
        found = match(independent, [state.key]).get(state.key);
      }
      state.status =
        found?.size === 1 ? 'ready' : found && found.size > 1 ? 'ambiguous' : 'changed';
      if (state.status === 'ready' && found) {
        const [start, end] = [...found][0]?.split(':').map(Number) ?? [];
        bindings.set(state.key, start === end ? null : (nodes[start ?? -1] ?? null));
      }
    }
  }
  if (!bounded || budget < 0) for (const state of textStates) state.status = 'unmapped';
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    const state = states[index];
    if (!field || !state) continue;
    if (field.kind === 'set-attribute') {
      state.status = host.getAttribute(field.name) === field.value ? 'ready' : 'changed';
    } else if (field.kind === 'set-style') {
      const cssName = field.property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const scratch = host.ownerDocument.createElement('div');
      let value = field.value;
      if (
        field.property !== 'color' &&
        field.property !== 'backgroundColor' &&
        /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)
      )
        value += 'px';
      scratch.style.setProperty(cssName, value);
      const expected = scratch.style.getPropertyValue(cssName);
      const actual = host.style?.getPropertyValue(cssName);
      state.status = expected && actual === expected ? 'ready' : 'changed';
    }
    if (state.status === 'ready' && field.kind === 'set-text' && bindings.has(state.key))
      bindNode?.(state.key, bindings.get(state.key) ?? null);
    if (state.status === 'changed')
      state.message = 'The displayed field no longer matches its source definition.';
    if (state.status === 'ambiguous')
      state.message =
        'Several text positions match this definition; its rendered origin is ambiguous.';
    if (state.status === 'unmapped')
      state.message = 'This field could not be mapped within the preview matching limits.';
  }
  return states;
}
