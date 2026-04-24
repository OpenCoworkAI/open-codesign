import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { type LoadedSkill, SkillFrontmatterV1 } from './types.js';

// ---------------------------------------------------------------------------
// Inline YAML frontmatter parser
//
// Supports the subset of YAML needed for SKILL.md files:
//   - Top-level key: value pairs
//   - Folded (>) and literal (|) block scalars
//   - Nested block mappings (indented sub-keys, e.g. "trigger:")
//   - Inline sequences: key: [a, b, c]
//   - Block sequences: "  - item"
//   - Scalar types: string, number, boolean, null
//
// Does NOT support anchors, multi-document streams, or complex types.
// ---------------------------------------------------------------------------

function parseScalar(s: string): unknown {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  const n = Number(t);
  if (!Number.isNaN(n) && t !== '') return n;
  return t;
}

function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

function indentOf(line: string): number {
  return line.match(/^(\s*)/)?.[1]?.length ?? 0;
}

function parseInlineSequence(s: string): unknown[] {
  const inner = s.slice(1, s.lastIndexOf(']'));
  return inner
    .split(',')
    .map(unquote)
    .filter((item) => item.length > 0);
}

function parseBlockScalar(
  lines: string[],
  start: number,
  baseIndent: number,
  style: '>' | '|',
): [string, number] {
  const blockLines: string[] = [];
  let i = start;
  while (i < lines.length) {
    const next = lines[i] ?? '';
    if (next.trim() === '') {
      blockLines.push('');
      i++;
      continue;
    }
    if (indentOf(next) <= baseIndent) break;
    blockLines.push(next.trim());
    i++;
  }
  // Folded (>) joins lines with spaces; literal (|) preserves newlines.
  const joiner = style === '|' ? '\n' : ' ';
  return [blockLines.join(joiner).trim(), i];
}

function parseBlockSequence(
  lines: string[],
  start: number,
  baseIndent: number,
): [unknown[], number] {
  const items: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const seqLine = lines[i] ?? '';
    if (seqLine.trim() === '') {
      i++;
      continue;
    }
    if (indentOf(seqLine) <= baseIndent) break;
    if (seqLine.trimStart().startsWith('- ')) {
      items.push(parseScalar(unquote(seqLine.replace(/^\s*-\s*/, '').trim())));
    }
    i++;
  }
  return [items, i];
}

function skipBlankLines(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;
  return i;
}

function isBlockScalarIndicator(s: string): boolean {
  return s === '>' || s === '|' || s.startsWith('> ') || s.startsWith('| ');
}

/** Resolve the value for an empty-after-colon key, returning [value, nextLineIndex]. */
function resolveEmptyValue(lines: string[], start: number, baseIndent: number): [unknown, number] {
  const lookAheadIdx = skipBlankLines(lines, start);
  const nextLine = lines[lookAheadIdx] ?? '';
  const nextIndent = indentOf(nextLine);

  if (nextIndent <= baseIndent) return [null, start];
  if (nextLine.trimStart().startsWith('- ')) return parseBlockSequence(lines, start, baseIndent);
  return parseMapping(lines, start, nextIndent);
}

/**
 * Classify a raw mapping line at `baseIndent` into one of:
 *   - 'skip'   : blank, comment, deeper-indented continuation, or colon-less line
 *   - 'break'  : indentation dropped below the current mapping scope
 *   - 'entry'  : a valid `key: value` pair at this mapping level
 */
type LineClassification =
  | { kind: 'skip' }
  | { kind: 'break' }
  | { kind: 'entry'; key: string; afterTrimmed: string };

function classifyMappingLine(raw: string, baseIndent: number): LineClassification {
  if (raw.trim() === '' || raw.trimStart().startsWith('#')) return { kind: 'skip' };

  const indent = indentOf(raw);
  if (indent < baseIndent) return { kind: 'break' };
  if (indent > baseIndent) return { kind: 'skip' };

  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return { kind: 'skip' };

  return {
    kind: 'entry',
    key: raw.slice(0, colonIdx).trim(),
    afterTrimmed: raw.slice(colonIdx + 1).trim(),
  };
}

/** Parse the value that follows `key:` on the same line, dispatching on its shape. */
function parseMappingValue(
  afterTrimmed: string,
  lines: string[],
  start: number,
  baseIndent: number,
): [unknown, number] {
  if (afterTrimmed.startsWith('[')) return [parseInlineSequence(afterTrimmed), start];
  if (isBlockScalarIndicator(afterTrimmed)) {
    const style = afterTrimmed.charAt(0) === '|' ? '|' : '>';
    return parseBlockScalar(lines, start, baseIndent, style);
  }
  if (afterTrimmed === '{}') return [{}, start];
  if (afterTrimmed === '') return resolveEmptyValue(lines, start, baseIndent);
  return [parseScalar(unquote(afterTrimmed)), start];
}

/**
 * Parse a sequence of YAML lines into a plain object.
 * `baseIndent` is the expected indentation level of keys in this mapping.
 */
function parseMapping(
  lines: string[],
  start: number,
  baseIndent: number,
): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const classification = classifyMappingLine(lines[i] ?? '', baseIndent);
    if (classification.kind === 'break') break;
    if (classification.kind === 'skip') {
      i++;
      continue;
    }

    i++;
    const [value, nextI] = parseMappingValue(classification.afterTrimmed, lines, i, baseIndent);
    result[classification.key] = value;
    i = nextI;
  }

  return [result, i];
}

interface ParsedMd {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): ParsedMd {
  // Match --- delimited frontmatter at the very start of the file
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };
  const yamlSrc = m[1] ?? '';
  const body = m[2] ?? '';
  const lines = yamlSrc.split('\n');
  const [frontmatter] = parseMapping(lines, 0, 0);
  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type SkillLoadOutcome = { ok: true; skill: LoadedSkill } | { ok: false; error: string };

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadSingleSkill(
  dir: string,
  entry: string,
  source: LoadedSkill['source'],
): Promise<SkillLoadOutcome> {
  const filePath = join(dir, entry);
  const id = basename(entry, '.md');

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Could not read ${filePath}: ${describeErr(err)}` };
  }

  let parsed: ParsedMd;
  try {
    parsed = parseFrontmatter(raw);
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse frontmatter in ${filePath}: ${describeErr(err)}`,
    };
  }

  // Merge: use filename as name fallback
  const raw_fm = { name: id, ...parsed.frontmatter };
  const result = SkillFrontmatterV1.safeParse(raw_fm);
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join('; ');
    return { ok: false, error: `Invalid frontmatter in ${filePath}: ${issues}` };
  }

  return {
    ok: true,
    skill: { id, source, frontmatter: result.data, body: parsed.body.trim() },
  };
}

export async function loadSkillsFromDir(
  dir: string,
  source: LoadedSkill['source'],
): Promise<LoadedSkill[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const mdEntries = entries.filter((entry) => extname(entry) === '.md');
  const outcomes = await Promise.all(mdEntries.map((entry) => loadSingleSkill(dir, entry, source)));

  const skills: LoadedSkill[] = [];
  const errors: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) skills.push(outcome.skill);
    else errors.push(outcome.error);
  }

  if (errors.length > 0) {
    throw new CodesignError(
      `Skill loading failed:\n${errors.join('\n')}`,
      ERROR_CODES.SKILL_LOAD_FAILED,
    );
  }

  return skills;
}

export interface LoadAllSkillsOptions {
  builtinDir: string;
  /** ~/.config/open-codesign/skills */
  userDir?: string | undefined;
  /** <project>/.codesign/skills */
  projectDir?: string | undefined;
}

/**
 * Load skills from all three tiers.
 * Priority order: project > user > builtin.
 * When two skills share the same id, the higher-priority one wins.
 */
export async function loadAllSkills(opts: LoadAllSkillsOptions): Promise<LoadedSkill[]> {
  const [builtin, user, project] = await Promise.all([
    loadSkillsFromDir(opts.builtinDir, 'builtin'),
    opts.userDir ? loadSkillsFromDir(opts.userDir, 'user') : Promise.resolve([]),
    opts.projectDir ? loadSkillsFromDir(opts.projectDir, 'project') : Promise.resolve([]),
  ]);

  // Merge with priority: project overrides user overrides builtin
  const map = new Map<string, LoadedSkill>();
  for (const skill of [...builtin, ...user, ...project]) {
    map.set(skill.id, skill);
  }

  return [...map.values()];
}

/**
 * Load skills from the user-editable skills directory.
 *
 * In the desktop app this resolves to `<userData>/templates/skills`. Pass
 * the path at call time so this module stays independent of boot wiring —
 * tests seed a tmpdir, the agent wires in the live path through
 * `GenerateInput.templatesRoot`.
 */
export async function loadBuiltinSkills(builtinDir: string): Promise<LoadedSkill[]> {
  return loadSkillsFromDir(builtinDir, 'builtin');
}
