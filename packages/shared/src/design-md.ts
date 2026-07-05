import { parse as parseYaml } from 'yaml';

export type DesignMdFindingSeverity = 'error' | 'warning' | 'info';

export interface DesignMdFinding {
  severity: DesignMdFindingSeverity;
  path: string;
  message: string;
}

export interface DesignMdBodySection {
  heading: string;
  content: string;
}

export interface DesignMdDocument {
  frontmatter: Record<string, unknown>;
  frontmatterText: string;
  body: string;
  bodySections: DesignMdBodySection[];
}

const FRONTMATTER_MAX_CHARS = 64 * 1024;
const BODY_PROMPT_MAX_CHARS = 2000;

const ALLOWED_TOP_LEVEL = new Set([
  'version',
  'name',
  'description',
  'colors',
  'typography',
  'rounded',
  'spacing',
  'components',
]);

const TYPOGRAPHY_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'fontFeature',
  'fontVariation',
]);

const COMPONENT_KEYS = new Set([
  'backgroundColor',
  'textColor',
  'typography',
  'rounded',
  'padding',
  'size',
  'height',
  'width',
]);

const KNOWN_SECTION_ORDER = [
  'Overview',
  'Colors',
  'Typography',
  'Layout',
  'Elevation & Depth',
  'Shapes',
  'Components',
  "Do's and Don'ts",
] as const;

const SECTION_ALIASES = new Map<string, (typeof KNOWN_SECTION_ORDER)[number]>([
  ['Brand & Style', 'Overview'],
  ['Layout & Spacing', 'Layout'],
  ['Elevation', 'Elevation & Depth'],
]);

const KNOWN_SECTION_INDEX: Map<string, number> = new Map(
  KNOWN_SECTION_ORDER.map((heading, index) => [heading, index]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function frontmatterBlock(raw: string): { frontmatterText: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('DESIGN.md must start with YAML frontmatter delimited by ---');
  }
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) {
    throw new Error('DESIGN.md frontmatter closing --- delimiter is missing');
  }
  const afterEnd = normalized[end + 4] === '\n' ? end + 5 : end + 4;
  const frontmatterText = normalized.slice(4, end);
  if (frontmatterText.length > FRONTMATTER_MAX_CHARS) {
    throw new Error('DESIGN.md YAML frontmatter exceeds 64KB');
  }
  return {
    frontmatterText,
    body: normalized.slice(afterEnd).trim(),
  };
}

function canonicalSectionHeading(heading: string): string {
  return SECTION_ALIASES.get(heading) ?? heading;
}

function parseBodySections(body: string): DesignMdBodySection[] {
  const sections: DesignMdBodySection[] = [];
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const next = matches[i + 1];
    const heading = match?.[1]?.trim() ?? '';
    const start = (match?.index ?? 0) + (match?.[0]?.length ?? 0);
    const end = next?.index ?? body.length;
    sections.push({ heading, content: body.slice(start, end).trim() });
  }
  return sections;
}

export function parseDesignMd(raw: string): DesignMdDocument {
  const { frontmatterText, body } = frontmatterBlock(raw);
  const parsed = parseYaml(frontmatterText) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('DESIGN.md frontmatter must be a YAML object');
  }
  return {
    frontmatter: parsed,
    frontmatterText,
    body,
    bodySections: parseBodySections(body),
  };
}

function error(path: string, message: string): DesignMdFinding {
  return { severity: 'error', path, message };
}

function validateString(
  findings: DesignMdFinding[],
  value: unknown,
  path: string,
  message: string,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    findings.push(error(path, message));
  }
}

function validateDimension(findings: DesignMdFinding[], value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?(?:px|em|rem)$/.test(value)) {
    findings.push(error(path, 'Expected a dimension with px, em, or rem unit'));
  }
}

function validateDimensionOrNumber(
  findings: DesignMdFinding[],
  value: unknown,
  path: string,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) return;
  validateDimension(findings, value, path);
}

function validateTokenReferenceOrString(
  findings: DesignMdFinding[],
  value: unknown,
  path: string,
): void {
  if (typeof value !== 'string') {
    findings.push(error(path, 'Expected a string or token reference'));
  }
}

function validateColors(findings: DesignMdFinding[], value: unknown): void {
  if (!isRecord(value)) {
    findings.push(error('colors', 'colors must be a map of token names to hex colors'));
    return;
  }
  for (const [name, color] of Object.entries(value)) {
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(color)) {
      findings.push(error(`colors.${name}`, 'Color tokens must be sRGB hex values'));
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
function validateTypography(findings: DesignMdFinding[], value: unknown): void {
  if (!isRecord(value)) {
    findings.push(
      error('typography', 'typography must be a map of token names to typography objects'),
    );
    return;
  }
  for (const [tokenName, rawToken] of Object.entries(value)) {
    if (!isRecord(rawToken)) {
      findings.push(error(`typography.${tokenName}`, 'Typography token must be an object'));
      continue;
    }
    for (const key of Object.keys(rawToken)) {
      if (!TYPOGRAPHY_KEYS.has(key)) {
        findings.push(error(`typography.${tokenName}.${key}`, 'Unknown typography property'));
      }
    }
    validateString(
      findings,
      rawToken['fontFamily'],
      `typography.${tokenName}.fontFamily`,
      'fontFamily is required',
    );
    if ('fontSize' in rawToken)
      validateDimension(findings, rawToken['fontSize'], `typography.${tokenName}.fontSize`);
    if (
      'fontWeight' in rawToken &&
      (typeof rawToken['fontWeight'] !== 'number' || !Number.isFinite(rawToken['fontWeight']))
    ) {
      findings.push(error(`typography.${tokenName}.fontWeight`, 'fontWeight must be a number'));
    }
    if ('lineHeight' in rawToken) {
      validateDimensionOrNumber(
        findings,
        rawToken['lineHeight'],
        `typography.${tokenName}.lineHeight`,
      );
    }
    if ('letterSpacing' in rawToken) {
      validateDimension(
        findings,
        rawToken['letterSpacing'],
        `typography.${tokenName}.letterSpacing`,
      );
    }
    if ('fontFeature' in rawToken) {
      validateString(
        findings,
        rawToken['fontFeature'],
        `typography.${tokenName}.fontFeature`,
        'fontFeature must be a string',
      );
    }
    if ('fontVariation' in rawToken) {
      validateString(
        findings,
        rawToken['fontVariation'],
        `typography.${tokenName}.fontVariation`,
        'fontVariation must be a string',
      );
    }
  }
}

function validateScale(
  findings: DesignMdFinding[],
  value: unknown,
  key: 'rounded' | 'spacing',
): void {
  if (!isRecord(value)) {
    findings.push(error(key, `${key} must be a map`));
    return;
  }
  for (const [name, rawValue] of Object.entries(value)) {
    if (key === 'spacing') validateDimensionOrNumber(findings, rawValue, `${key}.${name}`);
    else validateDimension(findings, rawValue, `${key}.${name}`);
  }
}

function validateComponents(findings: DesignMdFinding[], value: unknown): void {
  if (!isRecord(value)) {
    findings.push(error('components', 'components must be a map'));
    return;
  }
  for (const [componentName, rawComponent] of Object.entries(value)) {
    if (!isRecord(rawComponent)) {
      findings.push(
        error(`components.${componentName}`, 'Component token group must be an object'),
      );
      continue;
    }
    for (const [property, rawValue] of Object.entries(rawComponent)) {
      if (!COMPONENT_KEYS.has(property)) {
        findings.push(
          error(`components.${componentName}.${property}`, 'Unknown component property'),
        );
        continue;
      }
      validateTokenReferenceOrString(findings, rawValue, `components.${componentName}.${property}`);
    }
  }
}

function validateSections(findings: DesignMdFinding[], sections: DesignMdBodySection[]): void {
  const seen = new Set<string>();
  let lastKnown = -1;
  for (const section of sections) {
    const canonical = canonicalSectionHeading(section.heading);
    const index = KNOWN_SECTION_INDEX.get(canonical);
    if (index === undefined) continue;
    if (seen.has(canonical)) {
      findings.push(error(`body.${canonical}`, `Duplicate DESIGN.md section "${canonical}"`));
      continue;
    }
    seen.add(canonical);
    if (index < lastKnown) {
      findings.push(error(`body.${canonical}`, `Section "${canonical}" appears out of order`));
    }
    lastKnown = Math.max(lastKnown, index);
  }
}

export function validateDesignMd(raw: string): DesignMdFinding[] {
  const findings: DesignMdFinding[] = [];
  let doc: DesignMdDocument;
  try {
    doc = parseDesignMd(raw);
  } catch (err) {
    return [error('frontmatter', err instanceof Error ? err.message : String(err))];
  }

  for (const key of Object.keys(doc.frontmatter)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      findings.push(error(key, `Unknown Google DESIGN.md top-level field "${key}"`));
    }
  }
  validateString(findings, doc.frontmatter['name'], 'name', 'name is required');
  if ('version' in doc.frontmatter && typeof doc.frontmatter['version'] !== 'string') {
    findings.push(error('version', 'version must be a string'));
  }
  if ('description' in doc.frontmatter && typeof doc.frontmatter['description'] !== 'string') {
    findings.push(error('description', 'description must be a string'));
  }
  if ('colors' in doc.frontmatter) validateColors(findings, doc.frontmatter['colors']);
  if ('typography' in doc.frontmatter) validateTypography(findings, doc.frontmatter['typography']);
  if ('rounded' in doc.frontmatter) validateScale(findings, doc.frontmatter['rounded'], 'rounded');
  if ('spacing' in doc.frontmatter) validateScale(findings, doc.frontmatter['spacing'], 'spacing');
  if ('components' in doc.frontmatter) validateComponents(findings, doc.frontmatter['components']);
  validateSections(findings, doc.bodySections);
  return findings;
}

export function formatDesignMdForPrompt(raw: string): string {
  const doc = parseDesignMd(raw);
  const body = formatBodySectionsForPrompt(doc);
  return ['---', doc.frontmatterText.trimEnd(), '---', '', body].join('\n');
}

function orderedBodySections(doc: DesignMdDocument): DesignMdBodySection[] {
  if (doc.bodySections.length === 0) return [];
  const known: DesignMdBodySection[] = [];
  const unknown: DesignMdBodySection[] = [];
  for (const section of doc.bodySections) {
    const canonical = canonicalSectionHeading(section.heading);
    if (KNOWN_SECTION_INDEX.has(canonical)) known.push({ ...section, heading: canonical });
    else unknown.push(section);
  }
  known.sort((a, b) => {
    const aIndex = KNOWN_SECTION_INDEX.get(a.heading) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = KNOWN_SECTION_INDEX.get(b.heading) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
  return [...known, ...unknown];
}

function renderSection(section: DesignMdBodySection): string {
  return `## ${section.heading}\n\n${section.content}`.trimEnd();
}

function formatBodySectionsForPrompt(doc: DesignMdDocument): string {
  if (doc.bodySections.length === 0) {
    return doc.body.length > BODY_PROMPT_MAX_CHARS
      ? `${doc.body.slice(0, BODY_PROMPT_MAX_CHARS).trimEnd()}\n\n[DESIGN.md body truncated to ${BODY_PROMPT_MAX_CHARS} chars]`
      : doc.body;
  }

  const rendered = orderedBodySections(doc).map(renderSection);
  const full = rendered.join('\n\n');
  if (full.length <= BODY_PROMPT_MAX_CHARS) return full;

  const suffix = `\n\n[DESIGN.md body truncated to ${BODY_PROMPT_MAX_CHARS} chars]`;
  const cap = BODY_PROMPT_MAX_CHARS - suffix.length;
  const out: string[] = [];
  let used = 0;
  for (const block of rendered) {
    const separator = out.length === 0 ? '' : '\n\n';
    const nextLen = separator.length + block.length;
    if (used + nextLen <= cap) {
      out.push(block);
      used += nextLen;
      continue;
    }
    const remaining = cap - used - separator.length;
    if (remaining > 20) {
      out.push(block.slice(0, remaining).trimEnd());
    }
    break;
  }
  return `${out.join('\n\n')}${suffix}`;
}
