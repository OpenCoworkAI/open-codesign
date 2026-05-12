export type MarkdownHrefAction =
  | { kind: 'anchor'; href: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked' };

export function classifyMarkdownHref(rawHref: string | undefined): MarkdownHrefAction {
  const href = rawHref?.trim();
  if (!href) return { kind: 'blocked' };

  if (href.startsWith('#')) {
    return { kind: 'anchor', href };
  }

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return { kind: 'blocked' };
  }

  if (parsed.protocol !== 'https:') {
    return { kind: 'blocked' };
  }

  return { kind: 'external', url: parsed.href };
}
