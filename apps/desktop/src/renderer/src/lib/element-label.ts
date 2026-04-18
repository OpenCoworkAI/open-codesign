/**
 * Friendly identifier for a clicked canvas element.
 *
 * Inline-comment chips and popovers must NOT show raw XPath like
 * `/main[1]/section[3]/.../p[1]` — that surfaces no semantic intent and
 * intimidates non-technical users. Instead we synthesize a short, role-aware
 * label from the element's tag and its first ~30 characters of text content.
 */

import type { SelectedElement } from '@open-codesign/shared';

const TAG_LABELS: Record<string, string> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  a: 'link',
  button: 'button',
  img: 'image',
  svg: 'icon',
  i: 'icon',
  ul: 'list',
  ol: 'list',
  li: 'list item',
  section: 'section',
  header: 'header',
  footer: 'footer',
  nav: 'navigation',
  main: 'main content',
  aside: 'sidebar',
  article: 'article',
  figure: 'figure',
  blockquote: 'quote',
};

const TEXT_PREVIEW_MAX = 30;

export interface ElementLabel {
  /** Short role label for the element, e.g. "heading", "button". */
  role: string;
  /** First ~30 chars of visible text inside the element, trimmed. */
  text: string;
  /** Combined human-readable form, e.g. "heading · "Get started"". */
  display: string;
}

function extractText(outerHTML: string): string {
  // Strip tags and collapse whitespace. We do not need a full HTML parser —
  // outerHTML is short and trusted (came from the same iframe we rendered).
  const noTags = outerHTML.replace(/<[^>]*>/g, ' ');
  return noTags.replace(/\s+/g, ' ').trim();
}

function shorten(text: string): string {
  if (text.length <= TEXT_PREVIEW_MAX) return text;
  return `${text.slice(0, TEXT_PREVIEW_MAX - 1)}\u2026`;
}

export function getElementLabel(selection: Pick<SelectedElement, 'tag' | 'outerHTML'>): ElementLabel {
  const tag = selection.tag.toLowerCase();
  const role = TAG_LABELS[tag] ?? tag;
  const text = shorten(extractText(selection.outerHTML));
  const display = text.length > 0 ? `${role} \u00b7 \u201c${text}\u201d` : role;
  return { role, text, display };
}
