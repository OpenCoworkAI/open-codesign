import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { Type } from '@sinclair/typebox';

/**
 * `skill` tool. Lazy-loads the markdown body of a builtin design skill (or a
 * brand reference under `brand:<slug>`). Per-session de-dup so a second call
 * returns a short "already loaded" response instead of re-injecting the whole
 * text.
 *
 * Both directories live under the user-visible templates tree
 * (`<userData>/templates/skills/` and `<userData>/templates/brand-refs/`),
 * seeded from the app bundle on first boot and user-editable thereafter.
 * Paths are injected at factory time so tests can point at a tmpdir and the
 * production wiring stays out of `import.meta.url`.
 */

export interface SkillManifestEntry {
  name: string;
  category: 'design' | 'brand';
  source: 'builtin' | 'brand-ref';
  path: string;
}

export interface SkillRoots {
  skillsRoot?: string | null | undefined;
  brandRefsRoot?: string | null | undefined;
}

function isMissingPath(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function listSkillManifest(roots: SkillRoots): Promise<SkillManifestEntry[]> {
  const out: SkillManifestEntry[] = [];

  if (roots.skillsRoot) {
    try {
      const builtins = await readdir(roots.skillsRoot);
      for (const name of builtins) {
        if (!name.endsWith('.md')) continue;
        out.push({
          name: name.replace(/\.md$/, ''),
          category: 'design',
          source: 'builtin',
          path: path.join(roots.skillsRoot, name),
        });
      }
    } catch (err) {
      if (!isMissingPath(err)) throw err;
    }
  }

  if (roots.brandRefsRoot) {
    try {
      const brandSlugs = await readdir(roots.brandRefsRoot);
      for (const slug of brandSlugs) {
        if (slug.startsWith('.') || slug === 'manifest.json') continue;
        out.push({
          name: `brand:${slug}`,
          category: 'brand',
          source: 'brand-ref',
          path: path.join(roots.brandRefsRoot, slug, 'DESIGN.md'),
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
}

export async function invokeSkill(opts: InvokeSkillOptions): Promise<InvokeSkillResult> {
  if (opts.alreadyLoaded?.has(opts.name)) {
    return { status: 'already-loaded' };
  }
  const manifest = await listSkillManifest(opts.roots);
  const entry = manifest.find((e) => e.name === opts.name);
  if (!entry) {
    return { status: 'not-found', reason: `no skill registered as ${opts.name}` };
  }
  try {
    const body = await readFile(entry.path, 'utf8');
    return { status: 'loaded', body };
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
}

export interface MakeSkillToolOptions extends SkillRoots {
  dedup?: Set<string>;
}

export function makeSkillTool(
  opts: MakeSkillToolOptions = {},
): AgentTool<typeof SkillParams, SkillDetails> {
  const dedup = opts.dedup;
  const roots: SkillRoots = {
    ...(opts.skillsRoot !== undefined ? { skillsRoot: opts.skillsRoot } : {}),
    ...(opts.brandRefsRoot !== undefined ? { brandRefsRoot: opts.brandRefsRoot } : {}),
  };
  return {
    name: 'skill',
    label: 'Skill',
    description:
      'Load a concrete rules sheet for a builtin design skill (form-layout, ' +
      'empty-states, loading-skeleton, surface-elevation, cjk-typography, ' +
      'pitch-deck, mobile-mock, data-viz-recharts, frontend-design-anti-slop) ' +
      'or a brand reference ("brand:<slug>" — e.g. brand:vercel, brand:linear, ' +
      'brand:stripe). Call BEFORE writing code whenever the request matches. ' +
      'Returns markdown rules; treat them as load-bearing. One call per skill ' +
      'per session — repeat calls return a short already-loaded response.',
    parameters: SkillParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<SkillDetails>> {
      const name = params.name;
      if (dedup?.has(name)) {
        return {
          content: [
            {
              type: 'text',
              text: 'skill already loaded this session — refer to earlier tool result',
            },
          ],
          details: { name, status: 'already-loaded' },
        };
      }
      const result = await invokeSkill({
        name,
        roots,
        ...(dedup ? { alreadyLoaded: dedup } : {}),
      });
      if (result.status === 'loaded') {
        dedup?.add(name);
        return {
          content: [{ type: 'text', text: result.body ?? '' }],
          details: { name, status: 'loaded' },
        };
      }
      if (result.status === 'already-loaded') {
        return {
          content: [
            {
              type: 'text',
              text: 'skill already loaded this session — refer to earlier tool result',
            },
          ],
          details: { name, status: 'already-loaded' },
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `skill not found: ${name}. Available skills: run skill('__list__') or check the manifest`,
          },
        ],
        details: { name, status: 'not-found' },
      };
    },
  };
}
