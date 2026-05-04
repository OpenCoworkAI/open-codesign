export function collapseWhitespace(input: string): string {
  let out = '';
  let inWhitespace = false;
  for (const ch of input) {
    if (/\s/u.test(ch)) {
      if (!inWhitespace) out += ' ';
      inWhitespace = true;
    } else {
      out += ch;
      inWhitespace = false;
    }
  }
  return out;
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  colon: ':',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function decodeHtmlEntity(entity: string): string | null {
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    return safeFromCodePoint(Number.parseInt(entity.slice(2), 16));
  }
  if (entity.startsWith('#')) {
    return safeFromCodePoint(Number.parseInt(entity.slice(1), 10));
  }
  return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? null;
}

export function decodeHtmlEntities(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== '&') {
      out += ch;
      continue;
    }

    const semi = input.indexOf(';', i + 1);
    if (semi < 0) {
      out += ch;
      continue;
    }

    const rawEntity = input.slice(i + 1, semi);
    const decoded = decodeHtmlEntity(rawEntity);
    if (decoded === null) {
      out += input.slice(i, semi + 1);
    } else {
      out += decoded;
    }
    i = semi;
  }
  return out;
}

export function stripHtmlTags(input: string): string {
  let out = '';
  let inTag = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '<') {
      const next = input[i + 1] ?? '';
      const code = next.toLowerCase().charCodeAt(0);
      const startsTag = next === '/' || next === '!' || next === '?' || (code >= 97 && code <= 122);
      if (!startsTag) {
        out += ch;
        continue;
      }
      if (out.length > 0 && out[out.length - 1]?.trim().length !== 0) out += ' ';
      inTag = true;
      continue;
    }
    if (ch === '>' && inTag) {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out;
}

function tagOpenEnd(html: string, openStart: number): number {
  const end = html.indexOf('>', openStart);
  return end < 0 ? html.length : end + 1;
}

function findOpenTag(htmlLower: string, tagName: string, from: number): number {
  const needle = `<${tagName}`;
  let index = htmlLower.indexOf(needle, from);
  while (index >= 0) {
    const next = htmlLower[index + needle.length] ?? '';
    if (next === '>' || /\s/u.test(next)) return index;
    index = htmlLower.indexOf(needle, index + needle.length);
  }
  return -1;
}

export function findHtmlStartTag(
  html: string,
  tagName: string,
): { start: number; end: number; attrs: string; tag: string } | null {
  const tag = tagName.toLowerCase();
  const start = findOpenTag(html.toLowerCase(), tag, 0);
  if (start < 0) return null;
  const end = tagOpenEnd(html, start);
  return {
    start,
    end,
    attrs: html.slice(start + tag.length + 1, end - 1),
    tag: html.slice(start, end),
  };
}

export function insertAfterHtmlStartTag(html: string, tagName: string, content: string): string {
  const startTag = findHtmlStartTag(html, tagName);
  if (startTag === null) return html;
  return `${html.slice(0, startTag.end)}${content}${html.slice(startTag.end)}`;
}

export function insertBeforeHtmlEndTag(html: string, tagName: string, content: string): string {
  const lower = html.toLowerCase();
  const closeStart = findClosingTagStart(lower, tagName.toLowerCase(), 0);
  if (closeStart < 0) return html;
  return `${html.slice(0, closeStart)}${content}${html.slice(closeStart)}`;
}

function findClosingTagEnd(htmlLower: string, tagName: string, from: number): number {
  const start = htmlLower.indexOf(`</${tagName}`, from);
  if (start < 0) return -1;
  const end = htmlLower.indexOf('>', start);
  return end < 0 ? htmlLower.length : end + 1;
}

function findClosingTagStart(htmlLower: string, tagName: string, from: number): number {
  return htmlLower.indexOf(`</${tagName}`, from);
}

export function removeHtmlElementBlocks(html: string, tagName: string): string {
  const tag = tagName.toLowerCase();
  const lower = html.toLowerCase();
  let out = '';
  let cursor = 0;
  while (cursor < html.length) {
    const open = findOpenTag(lower, tag, cursor);
    if (open < 0) {
      out += html.slice(cursor);
      break;
    }
    out += html.slice(cursor, open);
    const openEnd = tagOpenEnd(html, open);
    const closeEnd = findClosingTagEnd(lower, tag, openEnd);
    cursor = closeEnd < 0 ? openEnd : closeEnd;
  }
  return out;
}

export function removeHtmlComments(html: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<!--', cursor);
    if (start < 0) {
      out += html.slice(cursor);
      break;
    }
    out += html.slice(cursor, start);
    const end = html.indexOf('-->', start + 4);
    cursor = end < 0 ? html.length : end + 3;
  }
  return out;
}

export function extractHtmlElementInner(html: string, tagName: string): string | null {
  const tag = tagName.toLowerCase();
  const lower = html.toLowerCase();
  const open = findOpenTag(lower, tag, 0);
  if (open < 0) return null;
  const openEnd = tagOpenEnd(html, open);
  const closeStart = findClosingTagStart(lower, tag, openEnd);
  if (closeStart < 0) return null;
  return html.slice(openEnd, closeStart);
}

export function getHtmlAttribute(tagAttrs: string, attrName: string): string | null {
  const name = attrName.toLowerCase();
  let index = 0;
  while (index < tagAttrs.length) {
    while (index < tagAttrs.length && /\s/u.test(tagAttrs[index] ?? '')) index += 1;
    const start = index;
    while (index < tagAttrs.length && /[^\s=]/u.test(tagAttrs[index] ?? '')) index += 1;
    const key = tagAttrs.slice(start, index).toLowerCase();
    while (index < tagAttrs.length && /\s/u.test(tagAttrs[index] ?? '')) index += 1;
    if (tagAttrs[index] !== '=') {
      if (key === name) return '';
      continue;
    }
    index += 1;
    while (index < tagAttrs.length && /\s/u.test(tagAttrs[index] ?? '')) index += 1;
    const quote = tagAttrs[index];
    let value = '';
    if (quote === '"' || quote === "'") {
      index += 1;
      const valueStart = index;
      const valueEnd = tagAttrs.indexOf(quote, valueStart);
      if (valueEnd < 0) {
        value = tagAttrs.slice(valueStart);
        index = tagAttrs.length;
      } else {
        value = tagAttrs.slice(valueStart, valueEnd);
        index = valueEnd + 1;
      }
    } else {
      const valueStart = index;
      while (index < tagAttrs.length && !/\s/u.test(tagAttrs[index] ?? '')) index += 1;
      value = tagAttrs.slice(valueStart, index);
    }
    if (key === name) return value;
  }
  return null;
}

export function transformHtmlElementBlocks(
  html: string,
  tagName: string,
  transform: (input: { attrs: string; body: string; tag: string }) => string,
): string {
  const tag = tagName.toLowerCase();
  const lower = html.toLowerCase();
  let out = '';
  let cursor = 0;
  while (cursor < html.length) {
    const open = findOpenTag(lower, tag, cursor);
    if (open < 0) {
      out += html.slice(cursor);
      break;
    }
    const openEnd = tagOpenEnd(html, open);
    const closeStart = findClosingTagStart(lower, tag, openEnd);
    const closeEnd = closeStart < 0 ? -1 : findClosingTagEnd(lower, tag, openEnd);
    if (closeStart < 0 || closeEnd < 0) {
      out += html.slice(cursor, openEnd);
      cursor = openEnd;
      continue;
    }
    out += html.slice(cursor, open);
    out += transform({
      attrs: html.slice(open + tag.length + 1, openEnd - 1),
      body: html.slice(openEnd, closeStart),
      tag: html.slice(open, closeEnd),
    });
    cursor = closeEnd;
  }
  return out;
}

export function removeCspMetaTags(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let cursor = 0;
  while (cursor < html.length) {
    const open = findOpenTag(lower, 'meta', cursor);
    if (open < 0) {
      out += html.slice(cursor);
      break;
    }
    const end = tagOpenEnd(html, open);
    const tag = lower.slice(open, end);
    if (tag.includes('http-equiv') && tag.includes('content-security-policy')) {
      out += html.slice(cursor, open);
    } else {
      out += html.slice(cursor, end);
    }
    cursor = end;
  }
  return out;
}
