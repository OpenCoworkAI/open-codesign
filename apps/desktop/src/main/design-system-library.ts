import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CreateLibraryDesignSystemInput,
  LibraryDesignSystem,
  LibraryDesignSystemDetail,
} from '@open-codesign/shared';
import { validateDesignMd } from '@open-codesign/shared/design-md';
import {
  defaultDesignMd,
  generateDesignSystemSample,
  syncDesignSystemSample,
} from './design-system-sample';

interface Validation {
  fingerprint: string;
  issues: string[];
  thumbnail: string | null;
}
interface Metadata {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  source: LibraryDesignSystem['source'];
  sessionDesignId: string | null;
  validation?: Validation;
}
const BRANDS = ['ibm', 'vercel', 'stripe'] as const;
const URLS = {
  ibm: 'https://carbondesignsystem.com',
  vercel: 'https://vercel.com/geist',
  stripe: 'https://stripe.com',
};
const DESCRIPTIONS = {
  ibm: 'Precise enterprise layouts / 精确紧凑的企业界面',
  vercel: 'Minimal monochrome surfaces / 克制的黑白界面',
  stripe: 'Expressive typography and surfaces / 富有表现力的排版与层次',
};
const MAX_BYTES = 4 * 1024 * 1024;

/** Reject junctions as well as final-file symlinks before any read/write/delete. */
async function safePath(file: string): Promise<void> {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (entry?.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${current}`);
  }
}
function title(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 160 ||
    /[\r\n]/.test(value) ||
    value.includes('\u0000')
  )
    throw new Error('Name must contain 1–160 characters');
  return value.trim();
}
function assets(raw: string): string[] {
  const refs = [
    ...raw.matchAll(
      /!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)|(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi,
    ),
  ];
  const found = new Set<string>();
  for (const match of refs) {
    const ref = decodeURIComponent(match[1] ?? match[2] ?? match[3] ?? '');
    if (/^(https?:|data:|#)/i.test(ref)) continue;
    if (path.isAbsolute(ref) || ref.startsWith('/') || /^[a-z][\w+.-]*:/i.test(ref))
      throw new Error(`External local asset path: ${ref}`);
    const clean = ref.split(/[?#]/)[0]?.replaceAll('\\', '/') ?? '';
    const segments = clean.split('/').filter((s) => s !== '.');
    if (
      segments.some((s) => s === '..' || s.startsWith('.')) ||
      segments.some((s) => s.includes(':') || s.includes('\u0000'))
    )
      throw new Error(`Unsafe resource path: ${ref}`);
    if (/\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|css)$/i.test(clean))
      found.add(segments.join('/'));
  }
  if (found.size > 64) throw new Error('Too many referenced resources');
  return [...found];
}
async function boundedRead(file: string): Promise<Buffer> {
  await safePath(file);
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_BYTES)
    throw new Error(`Missing or oversized resource: ${path.basename(file)}`);
  return readFile(file);
}

async function sampleResources(directory: string, source: string): Promise<string[]> {
  const result = new Set(assets(source));
  async function walk(dir: string, depth: number): Promise<void> {
    await safePath(dir);
    if (depth > 6) throw new Error('Sample resource directory is too deep');
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return [];
        throw err;
      },
    );
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      await safePath(file);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (/\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|css)$/i.test(entry.name))
        result.add(path.relative(directory, file).replaceAll('\\', '/'));
      if (result.size > 64) throw new Error('Too many sample resources');
    }
  }
  for (const folder of ['assets', 'fonts', 'images']) await walk(path.join(directory, folder), 0);
  return [...result];
}
async function copyData(source: string, destination: string, files: string[]): Promise<void> {
  await safePath(source);
  await safePath(destination);
  const planned = [];
  for (const relative of files) {
    const from = path.join(source, relative);
    const to = path.join(destination, relative);
    const bytes = await boundedRead(from);
    await safePath(to);
    const existing = await lstat(to).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (existing) throw new Error(`Refusing to overwrite existing file: ${relative}`);
    planned.push({ bytes, to });
  }
  const created: string[] = [];
  try {
    for (const entry of planned) {
      await safePath(entry.to);
      await mkdir(path.dirname(entry.to), { recursive: true });
      await writeFile(entry.to, entry.bytes, { flag: 'wx' });
      created.push(entry.to);
    }
  } catch (err) {
    for (const file of created.reverse()) await rm(file, { force: true });
    throw err;
  }
}

export class DesignSystemLibrary {
  readonly root: string;
  readonly builtinRoot: string;
  constructor(options: { root: string; builtinRoot: string }) {
    this.root = path.resolve(options.root);
    this.builtinRoot = path.resolve(options.builtinRoot);
  }
  private directory(id: string): string {
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id)) throw new Error('Invalid design system id');
    return path.join(this.root, id);
  }
  private async save(directory: string, metadata: Metadata): Promise<void> {
    await safePath(directory);
    await safePath(path.join(directory, 'system.json'));
    const temp = path.join(directory, `.system-${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, path.join(directory, 'system.json'));
  }
  async list(): Promise<LibraryDesignSystem[]> {
    const result: LibraryDesignSystem[] = [];
    for (const slug of BRANDS) result.push((await this.get(`builtin:${slug}`)).system);
    await safePath(this.root);
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return [];
        throw err;
      },
    );
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        result.push((await this.get(entry.name)).system);
      } catch {
        /* A damaged entry must not hide the rest of the library. */
      }
    }
    return result;
  }
  async get(id: string): Promise<LibraryDesignSystemDetail> {
    const slug = BRANDS.find((s) => id === `builtin:${s}`);
    if (id.startsWith('builtin:') && !slug) throw new Error('Unknown built-in system');
    const directory = slug ? path.join(this.builtinRoot, slug) : this.directory(id);
    await safePath(directory);
    const fileIssues: string[] = [];
    const readSource = async (name: string, fallback: string): Promise<string> => {
      try {
        return (await boundedRead(path.join(directory, name))).toString('utf8');
      } catch (error) {
        fileIssues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        return fallback;
      }
    };
    const designMd = await readSource('DESIGN.md', '');
    const metadata: Metadata = slug
      ? {
          schemaVersion: 1,
          id,
          name: slug === 'ibm' ? 'IBM' : slug === 'vercel' ? 'Vercel' : 'Stripe',
          description: DESCRIPTIONS[slug],
          source: {
            name: `${slug} reference · Not affiliated / 非官方`,
            url: URLS[slug],
            license: 'MIT — VoltAgent/awesome-design-md reference',
          },
          sessionDesignId: null,
        }
      : (JSON.parse(
          (await boundedRead(path.join(directory, 'system.json'))).toString('utf8'),
        ) as Metadata);
    if (slug) {
      try {
        metadata.validation = JSON.parse(
          (await boundedRead(path.join(this.root, `.builtin-${slug}.json`))).toString('utf8'),
        ) as Validation;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    if (metadata.schemaVersion !== 1 || metadata.id !== id)
      throw new Error('Invalid system metadata');
    const previewSource = slug
      ? generateDesignSystemSample(designMd, slug)
      : await readSource('App.jsx', generateDesignSystemSample(designMd));
    const hash = createHash('sha256').update(designMd).update('\0').update(previewSource);
    try {
      const resources = new Set([
        ...assets(designMd),
        ...(await sampleResources(directory, previewSource)),
      ]);
      for (const resource of resources) {
        try {
          hash.update(resource).update(await boundedRead(path.join(directory, resource)));
        } catch (error) {
          fileIssues.push(`${resource}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      fileIssues.push(error instanceof Error ? error.message : String(error));
    }
    const fingerprint = hash.digest('hex');
    let issues = [
      ...fileIssues,
      ...validateDesignMd(designMd)
        .filter((f) => f.severity === 'error')
        .map((f) => `${f.path}: ${f.message}`),
    ];
    const current = metadata.validation?.fingerprint === fingerprint;
    if (current) issues = [...issues, ...(metadata.validation?.issues ?? [])];
    return {
      designMd,
      previewSource,
      fingerprint,
      system: {
        schemaVersion: 1,
        id,
        name: metadata.name,
        description: metadata.description,
        builtin: Boolean(slug),
        status: (slug || current) && issues.length === 0 ? 'ready' : 'draft',
        source: metadata.source,
        sessionDesignId: metadata.sessionDesignId,
        workspacePath: directory,
        thumbnail: current ? (metadata.validation?.thumbnail ?? null) : null,
        issues,
      },
    };
  }
  async create(input: CreateLibraryDesignSystemInput): Promise<LibraryDesignSystemDetail> {
    const name = title(input.name);
    const id = randomUUID();
    const directory = this.directory(id);
    await safePath(this.root);
    await mkdir(directory, { recursive: true });
    const md = defaultDesignMd(name);
    await writeFile(path.join(directory, 'DESIGN.md'), md, { flag: 'wx' });
    await writeFile(path.join(directory, 'App.jsx'), generateDesignSystemSample(md), {
      flag: 'wx',
    });
    await this.save(directory, {
      schemaVersion: 1,
      id,
      name,
      description: input.description?.slice(0, 2000) ?? '',
      source: { name: 'User authored / 用户创建' },
      sessionDesignId: null,
    });
    return this.get(id);
  }
  async update(
    id: string,
    patch: { name?: string; description?: string; sessionDesignId?: string | null },
  ): Promise<LibraryDesignSystemDetail> {
    const directory = this.directory(id);
    await safePath(directory);
    const metadata = JSON.parse(
      (await boundedRead(path.join(directory, 'system.json'))).toString('utf8'),
    ) as Metadata;
    if (patch.name !== undefined) metadata.name = title(patch.name);
    if (patch.description !== undefined) metadata.description = patch.description.slice(0, 2000);
    if (patch.sessionDesignId !== undefined) metadata.sessionDesignId = patch.sessionDesignId;
    await this.save(directory, metadata);
    return this.get(id);
  }
  async fork(id: string, name?: string): Promise<LibraryDesignSystemDetail> {
    const original = await this.get(id);
    const created = await this.create({
      name: name ?? `${original.system.name} copy`,
      description: original.system.description,
    });
    const directory = created.system.workspacePath;
    try {
      await copyData(original.system.workspacePath, directory, [
        ...new Set([
          ...assets(original.designMd),
          ...(await sampleResources(original.system.workspacePath, original.previewSource)),
        ]),
      ]);
      await writeFile(path.join(directory, 'DESIGN.md'), original.designMd);
      await writeFile(path.join(directory, 'App.jsx'), original.previewSource);
      await this.save(directory, {
        schemaVersion: 1,
        id: created.system.id,
        name: created.system.name,
        description: original.system.description,
        source: { ...original.system.source, systemId: id },
        sessionDesignId: null,
      });
      return await this.get(created.system.id);
    } catch (err) {
      await this.remove(created.system.id);
      throw err;
    }
  }
  async importFile(
    file: string,
    name = path.basename(path.dirname(file)),
  ): Promise<LibraryDesignSystemDetail> {
    if (!/\.md$/i.test(file)) throw new Error('Select a DESIGN.md file');
    const raw = (await boundedRead(file)).toString('utf8');
    const resources = assets(raw);
    for (const resource of resources) await boundedRead(path.join(path.dirname(file), resource));
    const created = await this.create({
      name: title(name),
      description: 'Imported DESIGN.md / 导入的设计规范',
    });
    try {
      await copyData(path.dirname(file), created.system.workspacePath, resources);
      await writeFile(path.join(created.system.workspacePath, 'DESIGN.md'), raw);
      await writeFile(
        path.join(created.system.workspacePath, 'App.jsx'),
        generateDesignSystemSample(raw),
      );
      await this.save(created.system.workspacePath, {
        schemaVersion: 1,
        id: created.system.id,
        name: created.system.name,
        description: created.system.description,
        source: { name: path.basename(file) },
        sessionDesignId: null,
      });
      return await this.get(created.system.id);
    } catch (err) {
      await this.remove(created.system.id);
      throw err;
    }
  }
  async recordValidation(
    id: string,
    fingerprint: string,
    issues: string[],
    thumbnail: string | null = null,
  ): Promise<LibraryDesignSystem> {
    const detail = await this.get(id);
    if (detail.fingerprint !== fingerprint)
      throw new Error('System changed during validation; retry');
    if (detail.system.builtin) {
      await safePath(this.root);
      await mkdir(this.root, { recursive: true });
      const cache = path.join(this.root, `.builtin-${id.slice('builtin:'.length)}.json`);
      await safePath(cache);
      await writeFile(cache, JSON.stringify({ fingerprint, issues, thumbnail }), 'utf8');
      return { ...detail.system, status: issues.length ? 'draft' : 'ready', issues, thumbnail };
    }
    const directory = this.directory(id);
    const metadata = JSON.parse(
      (await boundedRead(path.join(directory, 'system.json'))).toString('utf8'),
    ) as Metadata;
    metadata.validation = { fingerprint, issues, thumbnail };
    await this.save(directory, metadata);
    return (await this.get(id)).system;
  }
  async syncPreview(id: string): Promise<LibraryDesignSystemDetail> {
    const detail = await this.get(id);
    if (
      detail.system.builtin ||
      validateDesignMd(detail.designMd).some((f) => f.severity === 'error')
    )
      return detail;
    const synced = syncDesignSystemSample(detail.designMd, detail.previewSource);
    if (synced !== detail.previewSource) {
      const file = path.join(detail.system.workspacePath, 'App.jsx');
      await safePath(file);
      if ((await boundedRead(file)).toString('utf8') !== detail.previewSource)
        throw new Error('Sample changed while updating tokens; retry');
      await writeFile(file, synced, 'utf8');
    }
    return this.get(id);
  }
  async apply(id: string, destination: string): Promise<void> {
    const detail = await this.get(id);
    if (detail.system.status !== 'ready')
      throw new Error('Validate and repair this design system before using it');
    await copyData(detail.system.workspacePath, destination, [
      'DESIGN.md',
      ...assets(detail.designMd),
    ]);
  }
  async remove(id: string): Promise<void> {
    const directory = this.directory(id);
    await safePath(directory);
    await rm(directory, { recursive: true, force: true });
  }
}
