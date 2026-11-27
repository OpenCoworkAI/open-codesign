const DISPLAY_UTILITIES = new Set([
  'block',
  'inline-block',
  'inline',
  'flex',
  'inline-flex',
  'table',
  'inline-table',
  'grid',
  'inline-grid',
  'contents',
  'hidden',
  'flow-root',
  'list-item',
]);

const TEXT_ALIGN_UTILITIES = new Set([
  'text-left',
  'text-center',
  'text-right',
  'text-justify',
  'text-start',
  'text-end',
]);

const TEXT_SIZE_UTILITIES = new Set([
  'text-xs',
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
  'text-4xl',
  'text-5xl',
  'text-6xl',
  'text-7xl',
  'text-8xl',
  'text-9xl',
]);

const TEXT_WRAP_UTILITIES = new Set(['text-wrap', 'text-nowrap', 'text-balance', 'text-pretty']);
const TEXT_OVERFLOW_UTILITIES = new Set(['truncate', 'text-ellipsis', 'text-clip']);
const TEXT_TRANSFORM_UTILITIES = new Set(['uppercase', 'lowercase', 'capitalize', 'normal-case']);

const FONT_WEIGHT_UTILITIES = new Set([
  'font-thin',
  'font-extralight',
  'font-light',
  'font-normal',
  'font-medium',
  'font-semibold',
  'font-bold',
  'font-extrabold',
  'font-black',
]);

const BORDER_STYLE_UTILITIES = new Set([
  'border-solid',
  'border-dashed',
  'border-dotted',
  'border-double',
  'border-hidden',
  'border-none',
]);

const FLEX_DIRECTION_UTILITIES = new Set([
  'flex-row',
  'flex-row-reverse',
  'flex-col',
  'flex-col-reverse',
]);

const FLEX_WRAP_UTILITIES = new Set(['flex-wrap', 'flex-wrap-reverse', 'flex-nowrap']);

const OBJECT_FIT_UTILITIES = new Set([
  'object-contain',
  'object-cover',
  'object-fill',
  'object-none',
  'object-scale-down',
]);

const SHADOW_SIZE_RE = /^shadow(?:-(?:none|2xs|xs|sm|md|lg|xl|2xl|inner|\[[^\]]+\]))?$/;
const ROUNDED_SIZE_RE = /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/;
const ROUNDED_SIDE_RE =
  /^rounded-(tl|tr|bl|br|ss|se|es|ee|t|r|b|l|s|e)(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/;
const BORDER_WIDTH_RE = /^border(?:-(?:0|2|4|8|\[(?:\d[^[\]]*|length:[^[\]]+)\]))?$/;
const BORDER_SIDE_WIDTH_RE =
  /^border-(t|r|b|l|x|y|s|e)(?:-(?:0|2|4|8|\[(?:\d[^[\]]*|length:[^[\]]+)\]))?$/;
const BORDER_SIDE_COLOR_RE = /^border-(t|r|b|l|x|y|s|e)-(.+)$/;

const TAILWIND_TOKEN_RE =
  /^(?:[a-z0-9-]+:)*!?(?:(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|-m|-mx|-my|-mt|-mr|-mb|-ml|gap|gap-x|gap-y|w|h|min-w|max-w|min-h|max-h|text|font|bg|border|rounded|flex|grid-cols|grid-rows|justify|items|self|opacity|shadow|overflow|object|leading|tracking|space-x|space-y|z|inset|top|right|bottom|left)(?:-[A-Za-z0-9./[\]#%_-]+)?|block|inline|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|truncate|uppercase|lowercase|capitalize|normal-case|border|rounded|shadow)$/;

function splitVariantPrefix(token: string): { prefix: string; utility: string } {
  let bracketDepth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '[') bracketDepth += 1;
    else if (ch === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === ':' && bracketDepth === 0) lastColon = i;
  }
  if (lastColon < 0) return { prefix: '', utility: token };
  return {
    prefix: token.slice(0, lastColon + 1),
    utility: token.slice(lastColon + 1),
  };
}

function textConflictGroup(base: string): string | null {
  if (TEXT_ALIGN_UTILITIES.has(base)) return 'text-align';
  if (TEXT_SIZE_UTILITIES.has(base)) return 'text-size';
  if (TEXT_WRAP_UTILITIES.has(base)) return 'text-wrap';
  if (TEXT_OVERFLOW_UTILITIES.has(base)) return 'text-overflow';
  if (!base.startsWith('text-')) return null;
  const rest = base.slice(5);
  if (/^\[(?:\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|ch)|length:[^\]]+)\]$/.test(rest)) {
    return 'text-size';
  }
  return 'text-color';
}

function fontConflictGroup(base: string): string | null {
  if (FONT_WEIGHT_UTILITIES.has(base) || /^font-\[(?:[1-9]\d{2}|number:[^\]]+)\]$/.test(base)) {
    return 'font-weight';
  }
  if (base.startsWith('font-')) return 'font-family';
  return null;
}

function bgConflictGroup(base: string): string | null {
  if (!base.startsWith('bg-')) return null;
  if (base.startsWith('bg-clip-')) return 'bg-clip';
  if (base.startsWith('bg-origin-')) return 'bg-origin';
  if (base === 'bg-repeat' || base === 'bg-no-repeat' || base.startsWith('bg-repeat-')) {
    return 'bg-repeat';
  }
  if (base === 'bg-cover' || base === 'bg-contain' || base === 'bg-auto') return 'bg-size';
  if (base === 'bg-fixed' || base === 'bg-local' || base === 'bg-scroll') return 'bg-attachment';
  if (
    base === 'bg-none' ||
    base.startsWith('bg-gradient-') ||
    base.startsWith('bg-linear-') ||
    base.startsWith('bg-radial-') ||
    base.startsWith('bg-conic-')
  ) {
    return 'bg-image';
  }
  if (
    ['bg-top', 'bg-bottom', 'bg-left', 'bg-right', 'bg-center'].includes(base) ||
    base.startsWith('bg-left-') ||
    base.startsWith('bg-right-')
  ) {
    return 'bg-position';
  }
  return 'bg-color';
}

function borderConflictGroup(base: string): string | null {
  if (BORDER_STYLE_UTILITIES.has(base)) return 'border-style';
  if (base === 'border-collapse' || base === 'border-separate') return 'border-collapse';
  if (BORDER_WIDTH_RE.test(base)) return 'border-width';
  const sideWidth = BORDER_SIDE_WIDTH_RE.exec(base);
  if (sideWidth?.[1]) return `border-${sideWidth[1]}-width`;
  const sideColor = BORDER_SIDE_COLOR_RE.exec(base);
  if (sideColor?.[1]) return `border-${sideColor[1]}-color`;
  if (base.startsWith('border-')) return 'border-color';
  return null;
}

function baseConflictGroup(rawUtility: string): string | null {
  const utility = rawUtility.startsWith('!') ? rawUtility.slice(1) : rawUtility;
  if (!utility) return null;

  if (DISPLAY_UTILITIES.has(utility)) return 'display';
  if (TEXT_TRANSFORM_UTILITIES.has(utility)) return 'text-transform';
  if (TEXT_OVERFLOW_UTILITIES.has(utility)) return 'text-overflow';
  if (OBJECT_FIT_UTILITIES.has(utility)) return 'object-fit';
  if (FLEX_DIRECTION_UTILITIES.has(utility)) return 'flex-direction';
  if (FLEX_WRAP_UTILITIES.has(utility)) return 'flex-wrap';

  const textGroup = textConflictGroup(utility);
  if (textGroup) return textGroup;

  const fontGroup = fontConflictGroup(utility);
  if (fontGroup) return fontGroup;

  const bgGroup = bgConflictGroup(utility);
  if (bgGroup) return bgGroup;

  const borderGroup = borderConflictGroup(utility);
  if (borderGroup) return borderGroup;

  if (ROUNDED_SIZE_RE.test(utility)) return 'rounded';
  const roundedSide = ROUNDED_SIDE_RE.exec(utility);
  if (roundedSide?.[1]) return `rounded-${roundedSide[1]}`;

  if (SHADOW_SIZE_RE.test(utility)) return 'shadow';
  if (utility.startsWith('shadow-')) return 'shadow-color';

  if (utility.startsWith('gap-x-')) return 'gap-x';
  if (utility.startsWith('gap-y-')) return 'gap-y';
  if (utility.startsWith('gap-')) return 'gap';

  if (utility.startsWith('overflow-x-')) return 'overflow-x';
  if (utility.startsWith('overflow-y-')) return 'overflow-y';
  if (utility.startsWith('overflow-')) return 'overflow';

  if (utility.startsWith('justify-items-')) return 'justify-items';
  if (utility.startsWith('justify-self-')) return 'justify-self';
  if (utility.startsWith('justify-')) return 'justify-content';

  const normalizedMargin = utility.startsWith('-') ? utility.slice(1) : utility;
  const spacedPrefix = /^(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me)-/.exec(
    normalizedMargin,
  );
  if (spacedPrefix?.[1]) return spacedPrefix[1];

  const simplePrefix =
    /^(w|h|min-w|max-w|min-h|max-h|opacity|items|self|leading|tracking|grid-cols|grid-rows|flex)-/.exec(
      utility,
    );
  if (simplePrefix?.[1]) return simplePrefix[1];

  return null;
}

function conflictKey(token: string): string {
  const { prefix, utility } = splitVariantPrefix(token);
  const group = baseConflictGroup(utility);
  return group ? `${prefix}::${group}` : `exact::${token}`;
}

export function mergeTailwindClasses(existing: string, incoming: string): string {
  const existingTokens = existing.trim().split(/\s+/).filter(Boolean);
  const incomingTokens = incoming.trim().split(/\s+/).filter(Boolean);

  // Deduplicate incoming tokens from right to left so the last utility wins within incoming.
  const dedupedIncoming: string[] = [];
  const incomingKeys = new Set<string>();
  for (let i = incomingTokens.length - 1; i >= 0; i -= 1) {
    const token = incomingTokens[i];
    if (!token) continue;
    const key = conflictKey(token);
    if (incomingKeys.has(key)) continue;
    incomingKeys.add(key);
    dedupedIncoming.push(token);
  }
  dedupedIncoming.reverse();

  // Keep only the latest occurrence of any existing non-conflicting utility.
  const keptExisting: string[] = [];
  const seenExistingKeys = new Set<string>();
  for (let i = existingTokens.length - 1; i >= 0; i -= 1) {
    const token = existingTokens[i];
    if (!token) continue;
    const key = conflictKey(token);
    if (incomingKeys.has(key) || seenExistingKeys.has(key)) continue;
    seenExistingKeys.add(key);
    keptExisting.push(token);
  }
  keptExisting.reverse();

  return [...keptExisting, ...dedupedIncoming].join(' ');
}

export function looksLikeTailwindClassName(className: string): boolean {
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((token) => TAILWIND_TOKEN_RE.test(token));
}
