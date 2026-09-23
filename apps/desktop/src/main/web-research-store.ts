import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type Evidence,
  type EvidenceInput,
  EvidenceInputSchema,
  type ResearchSlide,
  type ResearchStore,
  ResearchStoreSchema,
  type WebSource,
  WebSourceSchema,
} from '@open-codesign/shared';

const MAX_STORE_BYTES = 8 * 1024 * 1024;
const emptyStore = (): ResearchStore => ({
  schemaVersion: 1,
  sources: [],
  evidence: [],
  usages: [],
});

export function researchSourcePath(raw: string): string {
  const value = raw.replace(/\\/g, '/');
  if (
    !value ||
    value.startsWith('/') ||
    value.includes(':') ||
    value.split('/').some((p) => !p || p === '..' || p === '.')
  ) {
    throw new Error('Research source path must be workspace-relative.');
  }
  return value;
}

async function storePath(root: string, createDirectory = false): Promise<string> {
  const dir = path.join(root, '.codesign');
  if (createDirectory) await mkdir(dir, { recursive: true });
  try {
    const stat = await lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Research directory must be a directory, not a symlink.');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const file = path.join(dir, 'research.json');
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error('Research records must be a regular file.');
    if (stat.size > MAX_STORE_BYTES) throw new Error('Research records exceed the storage limit.');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return file;
}
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function validateResearchStore(raw: unknown): ResearchStore {
  const store = ResearchStoreSchema.parse(raw);
  for (const rows of [store.sources, store.evidence]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error('Duplicate research IDs.');
  }
  const sources = new Set(store.sources.map((s) => s.id));
  const evidence = new Set<string>();
  for (const item of store.evidence) {
    if (
      item.sourceIds.some((id) => !sources.has(id)) ||
      item.inputEvidenceIds.some((id) => !evidence.has(id))
    ) {
      throw new Error('Research records contain a dangling or cyclic evidence reference.');
    }
    evidence.add(item.id);
  }
  const usages = new Set<string>();
  for (const usage of store.usages) {
    researchSourcePath(usage.path);
    const key = `${usage.path}\n${usage.id}`;
    if (usages.has(key) || usage.evidenceIds.some((id) => !evidence.has(id)))
      throw new Error('Invalid slide evidence references.');
    usages.add(key);
  }
  return store;
}

export async function loadResearchStore(root: string): Promise<ResearchStore> {
  const file = await storePath(root);
  try {
    return validateResearchStore(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (isMissing(error)) return emptyStore();
    throw new Error(
      'Cannot restore research records: invalid schema or references. Repair .codesign/research.json before continuing.',
    );
  }
}

export async function saveResearchStore(root: string, store: ResearchStore): Promise<void> {
  validateResearchStore(store);
  const body = JSON.stringify(store, null, 2);
  if (Buffer.byteLength(body) > MAX_STORE_BYTES)
    throw new Error('Research records exceed the storage limit.');
  const file = await storePath(root, true);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, body, { flag: 'wx', mode: 0o600 });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export function saveSources(store: ResearchStore, sources: WebSource[]): void {
  for (const raw of sources) {
    const source = WebSourceSchema.parse(raw);
    if (source.originalRead) source.originalText = source.excerpt ?? '';
    const old = store.sources.find((s) => s.id === source.id);
    if (!old) store.sources.push(source);
    else {
      // Keep previously cited excerpts when the same URL is retrieved again.
      const excerpts = [
        ...new Set([old.excerpt, source.excerpt].filter((s): s is string => Boolean(s))),
      ];
      const excerpt = excerpts.join('\n\n');
      if (excerpt.length > 24000)
        throw new Error('Source excerpt history is full; reuse saved evidence instead.');
      Object.assign(old, source, {
        title: source.title ?? old.title,
        publisher: source.publisher ?? old.publisher,
        publishedAt: source.publishedAt ?? old.publishedAt,
        originalRead: old.originalRead || source.originalRead,
        excerpt: excerpt || null,
      });
    }
  }
}

export function recordEvidence(store: ResearchStore, raw: EvidenceInput): Evidence {
  const input = EvidenceInputSchema.parse(raw);
  const sources = input.sourceIds.map((id) => {
    const source = store.sources.find((s) => s.id === id);
    if (!source) throw new Error(`Unknown source ID: ${id}`);
    return source;
  });
  const inputs = input.inputEvidenceIds.map((id) => {
    const item = store.evidence.find((e) => e.id === id);
    if (!item) throw new Error(`Unknown input evidence ID: ${id}`);
    return item;
  });
  if (!sources.length && !inputs.length)
    throw new Error('Evidence needs saved sources or input evidence.');
  if (input.kind === 'calculation' && (!input.formula || !inputs.length))
    throw new Error('Calculated evidence requires input evidence IDs and a formula.');
  if (input.kind === 'fact' && !input.quote)
    throw new Error('Facts require an exact quote from saved source text.');
  if (input.quote && !sources.some((s) => s.excerpt?.includes(input.quote)))
    throw new Error(
      'Quote does not occur in saved source text. Do not invent or paraphrase quotations.',
    );
  if (input.locator && !sources.some((s) => s.locator === input.locator))
    throw new Error('Locator must match a saved source locator; omit it if unknown.');
  const item: Evidence = {
    ...input,
    id: `ev_${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)}`,
    originalRead:
      sources.every(
        (s) => s.originalRead && (!input.quote || s.originalText?.includes(input.quote)),
      ) && inputs.every((e) => e.originalRead),
  };
  if (!store.evidence.some((e) => e.id === item.id)) store.evidence.push(item);
  return item;
}

export function linkSlide(
  store: ResearchStore,
  sourcePath: string,
  slide: ResearchSlide,
  evidenceIds: string[],
): void {
  researchSourcePath(sourcePath);
  if (evidenceIds.some((id) => !store.evidence.some((e) => e.id === id)))
    throw new Error('Unknown evidence ID in slide usage.');
  store.usages = store.usages.filter((u) => u.path !== sourcePath || u.id !== slide.id);
  store.usages.push({ ...slide, path: sourcePath, evidenceIds: [...new Set(evidenceIds)] });
}

function md(value: string): string {
  return value.replace(/[\\`*_{}[\]<>#|!]/g, '\\$&').replace(/\r?\n/g, ' ');
}

export function buildSourcesMarkdown(
  store: ResearchStore,
  sourcePath: string,
  slides: ResearchSlide[],
): { markdown: string; warnings: string[] } {
  validateResearchStore(store);
  if (new Set(slides.map((s) => s.id)).size !== slides.length)
    throw new Error('Duplicate slide IDs.');
  const warnings: string[] = [];
  const lines = [
    '# Sources',
    '',
    'Generated from saved research records. Reading an original source is not verification of truth.',
    '',
  ];
  for (const [index, slide] of slides.entries()) {
    lines.push(`## ${index + 1}. ${md(slide.title || slide.id)}`, '');
    const usage = store.usages.find((u) => u.path === sourcePath && u.id === slide.id);
    if (!usage || usage.fingerprint !== slide.fingerprint) {
      const warning = `${slide.id}: ${usage ? 'content changed; evidence must be relinked' : 'no registered evidence'}`;
      warnings.push(warning);
      lines.push(`**Evidence gap:** ${md(warning)}.`, '');
      continue;
    }
    if (!usage.evidenceIds.length) lines.push('No external evidence registered for this page.', '');
    const visited = new Set<string>();
    const emit = (id: string, input = false): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const evidence = store.evidence.find((e) => e.id === id);
      if (!evidence) throw new Error('Missing evidence during export.');
      lines.push(
        `- ${input ? 'Calculation/input evidence: ' : ''}${md(evidence.claim)} (${evidence.id}; ${evidence.kind})`,
      );
      const context = [evidence.year, evidence.region, evidence.unit, evidence.scope].filter(
        Boolean,
      );
      if (context.length) lines.push(`  - Scope: ${context.map(md).join('; ')}`);
      if (evidence.formula) lines.push(`  - Formula: ${md(evidence.formula)}`);
      if (evidence.quote) lines.push(`  - Saved excerpt: “${md(evidence.quote)}”`);
      if (evidence.locator) lines.push(`  - Location: ${md(evidence.locator)}`);
      lines.push(
        `  - Original read: ${evidence.originalRead ? 'yes (not a fact certification)' : 'no; search excerpt only'}`,
      );
      if (evidence.conflict || evidence.insufficient || evidence.uncertainty)
        lines.push(
          `  - Unresolved: ${md(evidence.uncertainty || 'conflict or insufficient information')}; conflict=${evidence.conflict}; insufficient=${evidence.insufficient}`,
        );
      for (const sourceId of evidence.sourceIds) {
        const s = store.sources.find((source) => source.id === sourceId);
        if (!s) throw new Error('Missing source during export.');
        const url = new URL(s.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Invalid source URL.');
        lines.push(
          `  - [${md(s.title || s.url)}](<${url.href.replace(/>/g, '%3E')}>)${s.publisher ? ` — ${md(s.publisher)}` : ''}${s.publishedAt ? `; published ${md(s.publishedAt)}` : ''}; retrieved ${md(s.retrievedAt)}${s.locator ? `; ${md(s.locator)}` : ''}`,
        );
      }
      for (const inputId of evidence.inputEvidenceIds) emit(inputId, true);
    };
    for (const id of usage.evidenceIds) emit(id);
    lines.push('');
  }
  return { markdown: lines.join('\n'), warnings };
}

export async function writeUniqueSources(
  directory: string,
  stem: string,
  markdown: string,
): Promise<string> {
  for (let index = 0; index < 1000; index++) {
    const file = path.join(directory, `${stem}${index ? `-${index}` : ''}.md`);
    try {
      await writeFile(file, markdown, { flag: 'wx', mode: 0o600 });
      return file;
    } catch (error) {
      if (
        !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
      )
        throw error;
    }
  }
  throw new Error('Too many existing sources files; choose another export directory.');
}
