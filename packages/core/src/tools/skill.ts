import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { filterActive } from '@open-codesign/providers';
import { CodesignError, ERROR_CODES, type SourceIdentityV1 } from '@open-codesign/shared';
import { Type } from '@sinclair/typebox';
import { authoringProfileFor, nativeSkillPath } from '../authoring-profile.js';

/**
 * `skill` tool. Lazy-loads the markdown body of a builtin design skill (or a
 * brand reference under `brand:<slug>`). Per-session de-dup so a second call
 * returns a short "already loaded" response instead of re-injecting the whole
 * text.
 *
 * Both directories live under the user-visible templates tree
 * (`<userData>/templates/skills/` and `<userData>/templates/brand-refs/`),
 * seeded from the app bundle and upgraded by adding missing files only.
 * Paths are injected at factory time so tests can point at a tmpdir and the
 * production wiring stays out of `import.meta.url`.
 */

export interface SkillManifestEntry {
  name: string;
  category: 'design' | 'brand';
  source: 'builtin' | 'brand-ref';
  path: string;
  description: string;
  aliases: string[];
  dependencies: string[];
  validationHints: string[];
}

export interface SkillRoots {
  source?: SourceIdentityV1 | undefined;
  providerId?: string | undefined;
  skillsRoot?: string | null | undefined;
  brandRefsRoot?: string | null | undefined;
}

function isMissingPath(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveSafeManifestPath(root: string, candidate: string): Promise<string> {
  const absRoot = path.resolve(root);
  const absPath = path.resolve(candidate);
  if (!isWithinRoot(absRoot, absPath)) {
    throw new Error('registered path escapes template root');
  }

  const relative = path.relative(absRoot, absPath);
  if (relative.length === 0) return absPath;
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  let cursor = absRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `registered path traverses symbolic link: ${path.relative(absRoot, cursor)}`,
        );
      }
    } catch (err) {
      if (isMissingPath(err)) break;
      throw err;
    }
  }
  return absPath;
}

function rootForEntry(entry: SkillManifestEntry, roots: SkillRoots): string | null {
  if (entry.source === 'builtin') return roots.skillsRoot ?? null;
  return roots.brandRefsRoot ?? null;
}

export async function listSkillManifest(roots: SkillRoots): Promise<SkillManifestEntry[]> {
  const out: SkillManifestEntry[] = [];

  if (roots.skillsRoot) {
    const { loadSkillsFromDir } = await import('../skills/loader.js');
    const selected = await loadSkillsFromDir(roots.skillsRoot, 'builtin', roots.source);
    const builtins =
      authoringProfileFor(roots.source) === 'native-html'
        ? filterActive(selected, roots.providerId ?? '')
        : selected;
    for (const skill of builtins) {
      out.push({
        name: skill.frontmatter.name,
        category: 'design',
        source: 'builtin',
        path: path.join(roots.skillsRoot, nativeSkillPath(skill.id, roots.source)),
        description: skill.frontmatter.description,
        aliases: skill.frontmatter.aliases,
        dependencies: skill.frontmatter.dependencies,
        validationHints: skill.frontmatter.validationHints,
      });
    }
  }

  if (roots.brandRefsRoot) {
    try {
      const manifestPath = path.join(roots.brandRefsRoot, 'manifest.json');
      const raw = await readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { brands?: unknown }).brands)
      ) {
        for (const brand of (parsed as { brands: unknown[] }).brands) {
          if (typeof brand !== 'object' || brand === null) continue;
          const record = brand as Record<string, unknown>;
          if (
            typeof record['slug'] !== 'string' ||
            typeof record['path'] !== 'string' ||
            typeof record['name'] !== 'string'
          ) {
            continue;
          }
          const category =
            typeof record['category'] === 'string' ? record['category'] : 'Brand reference';
          out.push({
            name: `brand:${record['slug']}`,
            category: 'brand',
            source: 'brand-ref',
            path: path.join(roots.brandRefsRoot, record['path']),
            description: `${record['name']} brand reference (${category}).`,
            aliases: [record['name']],
            dependencies: [],
            validationHints: [],
          });
        }
        return out;
      }
    } catch (err) {
      if (!isMissingPath(err)) throw err;
    }

    try {
      const brandSlugs = await readdir(roots.brandRefsRoot);
      for (const slug of brandSlugs) {
        if (slug.startsWith('.') || slug === 'manifest.json') continue;
        out.push({
          name: `brand:${slug}`,
          category: 'brand',
          source: 'brand-ref',
          path: path.join(roots.brandRefsRoot, slug, 'DESIGN.md'),
          description: `Brand reference for ${slug}.`,
          aliases: [],
          dependencies: [],
          validationHints: [],
        });
      }
    } catch (err) {
      if (!isMissingPath(err)) throw err;
    }
  }

  return out;
}

export interface InvokeSkillOptions {
  name: string;
  roots: SkillRoots;
  alreadyLoaded?: ReadonlySet<string>;
}

export interface InvokeSkillResult {
  status: 'loaded' | 'already-loaded' | 'not-found';
  body?: string;
  reason?: string;
  metadata?: SkillManifestEntry;
}

function skillDedupKey(entry: SkillManifestEntry, roots: SkillRoots): string {
  if (authoringProfileFor(roots.source) === 'legacy') return entry.name;
  return JSON.stringify([
    'native-html',
    path.resolve(rootForEntry(entry, roots) ?? '.'),
    roots.providerId ?? '',
    entry.name,
    path.resolve(entry.path),
  ]);
}

export async function invokeSkill(opts: InvokeSkillOptions): Promise<InvokeSkillResult> {
  const manifest = await listSkillManifest(opts.roots);
  const native = authoringProfileFor(opts.roots.source) === 'native-html';
  let entry = manifest.find(
    (e) => e.name === opts.name || (!native && e.aliases.includes(opts.name)),
  );
  if (!entry && native) {
    const canonicalFiles = opts.roots.skillsRoot
      ? await readdir(opts.roots.skillsRoot).catch((err: unknown) => {
          if (isMissingPath(err)) return [];
          throw err;
        })
      : [];
    if (canonicalFiles.includes(`${opts.name}.md`)) {
      return { status: 'not-found', reason: `skill unavailable for this run: ${opts.name}` };
    }
    entry = manifest.find((e) => e.aliases.includes(opts.name));
  }
  if (!entry) {
    return { status: 'not-found', reason: `no skill registered as ${opts.name}` };
  }
  if (
    opts.alreadyLoaded?.has(skillDedupKey(entry, opts.roots)) ||
    (authoringProfileFor(opts.roots.source) === 'legacy' && opts.alreadyLoaded?.has(opts.name))
  ) {
    return { status: 'already-loaded', metadata: entry };
  }
  try {
    const root = rootForEntry(entry, opts.roots);
    if (root === null) {
      throw new Error(`template root unavailable for ${entry.name}`);
    }
    const body = await readFile(await resolveSafeManifestPath(root, entry.path), 'utf8');
    return { status: 'loaded', body, metadata: entry };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesignError(
      `Skill "${opts.name}" is registered but could not be read: ${message}`,
      ERROR_CODES.SKILL_LOAD_FAILED,
      { cause: err },
    );
  }
}

const SkillParams = Type.Object({
  name: Type.String({
    minLength: 1,
    description:
      'Skill to load. Either a builtin design skill name (e.g. "form-layout", ' +
      '"empty-states", "loading-skeleton", "surface-elevation", "cjk-typography") ' +
      'or a brand reference as "brand:<slug>" (e.g. "brand:vercel", "brand:linear", ' +
      '"brand:stripe").',
  }),
});

export interface SkillDetails {
  name: string;
  status: 'loaded' | 'already-loaded' | 'not-found';
  description?: string;
  aliases?: string[];
  dependencies?: string[];
  validationHints?: string[];
}

export interface MakeSkillToolOptions extends SkillRoots {
  dedup?: Set<string>;
}

export function makeSkillTool(
  opts: MakeSkillToolOptions = {},
): AgentTool<typeof SkillParams, SkillDetails> {
  const dedup = opts.dedup;
  const roots: SkillRoots = {
    source: opts.source,
    providerId: opts.providerId,
    ...(opts.skillsRoot !== undefined ? { skillsRoot: opts.skillsRoot } : {}),
    ...(opts.brandRefsRoot !== undefined ? { brandRefsRoot: opts.brandRefsRoot } : {}),
  };
  return {
    name: 'skill',
    label: 'Skill',
    description:
      authoringProfileFor(opts.source) === 'native-html'
        ? 'Load an advertised native method (for example craft-polish or chart-rendering) or reference-only brand:<slug>. Guidance does not copy files. Native overlays and provider eligibility apply to direct calls; repeat calls are deduplicated for this profile and resource root.'
        : 'Load a concrete markdown rules sheet for a builtin method skill ' +
          '(for example form-layout, responsive-layout, accessibility-states, ' +
          'design-system-baton, app-shell-navigation, pitch-deck, mobile-mock, ' +
          'data-viz-recharts) or a reference-only brand DESIGN.md as "brand:<slug>" ' +
          '(for example brand:vercel, brand:linear, brand:stripe). Call BEFORE ' +
          'writing code whenever the request matches. This tool loads guidance; it ' +
          'does not copy scaffold files. One call per skill per session; repeat ' +
          'calls return a short already-loaded response.',
    parameters: SkillParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<SkillDetails>> {
      const name = params.name;
      const result = await invokeSkill({
        name,
        roots,
        ...(dedup ? { alreadyLoaded: dedup } : {}),
      });
      if (result.status === 'loaded') {
        const canonicalName = result.metadata?.name ?? name;
        if (result.metadata) dedup?.add(skillDedupKey(result.metadata, roots));
        return {
          content: [{ type: 'text', text: result.body ?? '' }],
          details: {
            name: canonicalName,
            status: 'loaded',
            ...(result.metadata?.description !== undefined
              ? { description: result.metadata.description }
              : {}),
            ...(result.metadata?.aliases !== undefined ? { aliases: result.metadata.aliases } : {}),
            ...(result.metadata?.dependencies !== undefined
              ? { dependencies: result.metadata.dependencies }
              : {}),
            ...(result.metadata?.validationHints !== undefined
              ? { validationHints: result.metadata.validationHints }
              : {}),
          },
        };
      }
      if (result.status === 'already-loaded') {
        const canonicalName = result.metadata?.name ?? name;
        return {
          content: [
            {
              type: 'text',
              text: 'skill already loaded this session — refer to earlier tool result',
            },
          ],
          details: { name: canonicalName, status: 'already-loaded' },
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `skill not found: ${name}. Available skills are listed in the resource manifest.`,
          },
        ],
        details: { name, status: 'not-found' },
      };
    },
  };
}
