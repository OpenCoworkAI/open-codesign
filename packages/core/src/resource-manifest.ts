import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { filterActive } from '@open-codesign/providers';
import {
  type LoadedSkill,
  RESOURCE_MANIFEST_SCHEMA_VERSION,
  type ResourceManifestEntryV1,
  type ResourceManifestV1,
} from '@open-codesign/shared';
import type { CoreLogger } from './logger.js';
import { loadScaffoldManifest, type ScaffoldManifest } from './tools/scaffold.js';

export interface ResourceManifestResult {
  manifest: ResourceManifestV1;
  sections: string[];
  warnings: string[];
  skillCount: number;
  scaffoldCount: number;
  brandCount: number;
}

interface BrandManifestEntry {
  slug: string;
  name: string;
  category: string;
  path: string;
}

function oneLine(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}...` : normalized;
}

function skillWhenToUse(skill: LoadedSkill): string {
  const description = skill.frontmatter.description;
  return oneLine(description, 220);
}

function skillEntry(skill: LoadedSkill, skillsRoot: string): ResourceManifestEntryV1 {
  return {
    name: skill.frontmatter.name,
    description: oneLine(skill.frontmatter.description),
    category: 'skill',
    aliases: skill.frontmatter.aliases,
    whenToUse: skillWhenToUse(skill),
    dependencies: skill.frontmatter.dependencies,
    source: skill.source,
    license: 'MIT',
    path: path.relative(skillsRoot, path.join(skillsRoot, `${skill.id}.md`)),
  };
}

function scaffoldEntries(
  manifest: ScaffoldManifest,
  scaffoldsRoot: string,
): ResourceManifestEntryV1[] {
  return Object.entries(manifest.scaffolds)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, scaffold]) => ({
      name,
      description: oneLine(scaffold.description),
      category: 'scaffold',
      aliases: scaffold.aliases ?? [],
      whenToUse: scaffold.category ?? oneLine(scaffold.description),
      dependencies: [],
      source: scaffold.source,
      license: scaffold.license,
      path: path.relative(scaffoldsRoot, path.resolve(scaffoldsRoot, scaffold.path)),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBrandManifest(raw: unknown): BrandManifestEntry[] {
  if (!isRecord(raw) || raw['schemaVersion'] !== 1 || !Array.isArray(raw['brands'])) {
    throw new Error('brand manifest must contain schemaVersion: 1 and brands[]');
  }
  return raw['brands'].map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`brand manifest entry ${index} must be an object`);
    const slug = entry['slug'];
    const name = entry['name'];
    const category = entry['category'];
    const entryPath = entry['path'];
    if (
      typeof slug !== 'string' ||
      typeof name !== 'string' ||
      typeof category !== 'string' ||
      typeof entryPath !== 'string'
    ) {
      throw new Error(`brand manifest entry ${index} is missing slug/name/category/path`);
    }
    return { slug, name, category, path: entryPath };
  });
}

async function loadBrandEntries(brandRefsRoot: string): Promise<ResourceManifestEntryV1[]> {
  const manifestPath = path.join(brandRefsRoot, 'manifest.json');
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return parseBrandManifest(JSON.parse(raw) as unknown).map((brand) => ({
      name: `brand:${brand.slug}`,
      description: `${brand.name} brand reference (${brand.category}).`,
      category: 'brand-ref',
      aliases: [brand.name],
      whenToUse: `Use when the user explicitly asks for ${brand.name} or brand:${brand.slug}.`,
      dependencies: [],
      source: 'Open CoDesign curated brand reference',
      license: 'reference-only',
      path: brand.path,
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const dirs = await readdir(brandRefsRoot, { withFileTypes: true });
  return dirs
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: `brand:${entry.name}`,
      description: `Brand reference for ${entry.name}.`,
      category: 'brand-ref' as const,
      aliases: [],
      whenToUse: `Use when the user explicitly asks for brand:${entry.name}.`,
      dependencies: [],
      source: 'Open CoDesign curated brand reference',
      license: 'reference-only',
      path: `${entry.name}/DESIGN.md`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function formatResourceLine(entry: ResourceManifestEntryV1): string {
  const details: string[] = [oneLine(entry.description, 120)];
  if (entry.dependencies.length > 0) details.push(`deps: ${entry.dependencies.join(', ')}`);
  return `- ${entry.name}: ${oneLine(details.join(' | '), 170)}`;
}

function groupEntries(
  entries: ResourceManifestEntryV1[],
  category: ResourceManifestEntryV1['category'],
) {
  return entries
    .filter((entry) => entry.category === category)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map(formatResourceLine);
}

function formatScaffoldGroups(entries: ResourceManifestEntryV1[]): string[] {
  const groups = new Map<string, string[]>();
  for (const entry of entries.filter((item) => item.category === 'scaffold')) {
    const category = entry.whenToUse.includes(' ')
      ? entry.path.split('/')[0] || 'other'
      : entry.whenToUse;
    const list = groups.get(category) ?? [];
    list.push(entry.name);
    groups.set(category, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([category, names]) => {
      const sorted = names.sort((a, b) => a.localeCompare(b, 'en'));
      const examples = sorted.slice(0, 5).join(', ');
      const suffix = sorted.length > 5 ? `, +${sorted.length - 5} more` : '';
      return `- ${category}: ${sorted.length} scaffold(s), examples: ${examples}${suffix}`;
    });
}

function formatBrandSummary(entries: ResourceManifestEntryV1[]): string {
  const names = entries
    .filter((entry) => entry.category === 'brand-ref')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  if (names.length === 0) return 'No brand references available.';
  const shown = names.slice(0, 40).join(', ');
  return names.length > 40 ? `${shown}, +${names.length - 40} more` : shown;
}

export function formatResourceManifestForPrompt(manifest: ResourceManifestV1): string | null {
  if (manifest.entries.length === 0) return null;
  const skillLines = groupEntries(manifest.entries, 'skill');
  const scaffoldLines = formatScaffoldGroups(manifest.entries);
  const brandLine = formatBrandSummary(manifest.entries);
  return [
    '# Available Resources',
    '',
    'Progressive disclosure is manifest-first: choose from this index, then call `skill(name)` or `scaffold({kind, destPath})` before writing. This manifest is only a summary; it does not contain skill bodies or scaffold code.',
    '',
    '## Design Skills',
    skillLines.length > 0 ? skillLines.join('\n') : 'No design skills available.',
    '',
    '## Scaffolds',
    scaffoldLines.length > 0 ? scaffoldLines.join('\n') : 'No scaffolds available.',
    '',
    '## Brand References',
    brandLine,
  ].join('\n');
}

export async function collectResourceManifest(input: {
  log: CoreLogger;
  providerId: string;
  templatesRoot: string | undefined;
}): Promise<ResourceManifestResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const entries: ResourceManifestEntryV1[] = [];
  const skillsRoot = input.templatesRoot ? path.join(input.templatesRoot, 'skills') : undefined;
  const scaffoldsRoot = input.templatesRoot
    ? path.join(input.templatesRoot, 'scaffolds')
    : undefined;
  const brandRefsRoot = input.templatesRoot
    ? path.join(input.templatesRoot, 'brand-refs')
    : undefined;

  if (!input.templatesRoot) {
    return {
      manifest: { schemaVersion: RESOURCE_MANIFEST_SCHEMA_VERSION, entries: [] },
      sections: [],
      warnings: [],
      skillCount: 0,
      scaffoldCount: 0,
      brandCount: 0,
    };
  }

  try {
    const { loadBuiltinSkills } = await import('./skills/loader.js');
    const activeSkills = filterActive(await loadBuiltinSkills(skillsRoot ?? ''), input.providerId);
    entries.push(...activeSkills.map((skill) => skillEntry(skill, skillsRoot ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    input.log.warn('[generate] step=load_resource_manifest.skills.fail', {
      errorClass,
      message,
    });
    warnings.push(`Skill manifest unavailable: ${message}`);
  }

  try {
    if (scaffoldsRoot) {
      entries.push(...scaffoldEntries(await loadScaffoldManifest(scaffoldsRoot), scaffoldsRoot));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    input.log.warn('[generate] step=load_resource_manifest.scaffolds.fail', {
      errorClass,
      message,
    });
    warnings.push(`Scaffold manifest unavailable: ${message}`);
  }

  try {
    if (brandRefsRoot) entries.push(...(await loadBrandEntries(brandRefsRoot)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.constructor.name : typeof err;
    input.log.warn('[generate] step=load_resource_manifest.brand_refs.fail', {
      errorClass,
      message,
    });
    warnings.push(`Brand references unavailable: ${message}`);
  }

  const manifest = { schemaVersion: RESOURCE_MANIFEST_SCHEMA_VERSION, entries };
  const section = formatResourceManifestForPrompt(manifest);
  const skillCount = entries.filter((entry) => entry.category === 'skill').length;
  const scaffoldCount = entries.filter((entry) => entry.category === 'scaffold').length;
  const brandCount = entries.filter((entry) => entry.category === 'brand-ref').length;
  input.log.info('[generate] step=load_resource_manifest.ok', {
    ms: Date.now() - start,
    skills: skillCount,
    scaffolds: scaffoldCount,
    brandRefs: brandCount,
    warnings: warnings.length,
  });
  return {
    manifest,
    sections: section ? [section] : [],
    warnings,
    skillCount,
    scaffoldCount,
    brandCount,
  };
}
