import { type Static, Type } from '@sinclair/typebox';

/**
 * Comment anchor (T2.5).
 *
 * When the user pins a comment to a specific element in the preview
 * iframe, we need a stable, low-noise way to describe that element to
 * the agent in the next user message. Goals:
 *   - DOM path that survives minor edits (sibling reordering, class
 *     renames) — use tagName + nth-of-type.
 *   - Inline text excerpt for human readability (capped to ~60 chars).
 *   - Optional computed-style snapshot of the visually-load-bearing
 *     properties so the agent doesn't need to re-parse the artifact.
 *
 * Persistence: the anchor is appended as a content block on a
 * SessionMessageEntry (`role: 'user'`) in the session JSONL.
 */

export const CommentAnchor = Type.Object({
  domPath: Type.Array(Type.String(), { minItems: 1, maxItems: 12 }),
  innerText: Type.Optional(Type.String({ maxLength: 80 })),
  computedStyles: Type.Optional(Type.Record(Type.String(), Type.String(), { maxProperties: 12 })),
  rect: Type.Optional(
    Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      width: Type.Number(),
      height: Type.Number(),
    }),
  ),
});
export type CommentAnchor = Static<typeof CommentAnchor>;

const TRACKED_STYLES = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'padding',
  'margin',
  'border-radius',
  'display',
  'opacity',
  'box-shadow',
];

export interface BuildAnchorInput {
  /** Path of element ancestors from the iframe document root.
   *  Each segment uses `tag` plus `:nth-of-type(N)` when needed. */
  path: ReadonlyArray<string>;
  text?: string;
  styles?: Readonly<Record<string, string>>;
  rect?: { x: number; y: number; width: number; height: number };
}

export function buildAnchor(input: BuildAnchorInput): CommentAnchor {
  const domPath = input.path.slice(-12);
  const anchor: CommentAnchor = { domPath };
  if (input.text) anchor.innerText = truncateText(input.text, 80);
  if (input.styles) anchor.computedStyles = pickStyles(input.styles);
  if (input.rect) anchor.rect = input.rect;
  return anchor;
}

function truncateText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function pickStyles(styles: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TRACKED_STYLES) {
    const v = styles[key];
    if (v !== undefined && v !== '') out[key] = v;
  }
  return out;
}

/**
 * Render an anchor into the wire-format string the agent sees.
 * Compact YAML-ish so it survives prompt-string concatenation.
 */
export function formatAnchorForPrompt(anchor: CommentAnchor): string {
  const lines = ['<comment-anchor>', `path: ${anchor.domPath.join(' > ')}`];
  if (anchor.innerText) lines.push(`text: "${anchor.innerText}"`);
  if (anchor.rect)
    lines.push(
      `rect: x=${anchor.rect.x} y=${anchor.rect.y} w=${anchor.rect.width} h=${anchor.rect.height}`,
    );
  if (anchor.computedStyles) {
    lines.push('styles:');
    for (const [k, v] of Object.entries(anchor.computedStyles)) lines.push(`  ${k}: ${v}`);
  }
  lines.push('</comment-anchor>');
  return lines.join('\n');
}
