import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * `scaffold` tool (T3.2). Inlines the pre-bundled starter files at build time
 * via `import.meta.glob` so the tool works identically in dev, production,
 * and test, and after electron-vite bundles `packages/core/src/tools/scaffold.ts`
 * into `apps/desktop/out/main/index.js`. Previously we resolved a runtime
 * SCAFFOLDS_ROOT from `import.meta.url`, which broke after bundling because
 * the JS moved away from the source tree.
 *
 * Any tooling that ingests packages/core (vite, electron-vite, vitest) handles
 * this glob. It is NOT compatible with plain tsc + node — acceptable because
 * packages/core is an internal workspace dep, never published.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
// biome-ignore lint/correctness/noUnusedImports: used by import.meta.glob (vite)
import manifestJson from '../scaffolds/manifest.json' with { type: 'json' };

interface ManifestEntry {
  description: string;
  path: string;
  category?: string;
  license?: string;
}

interface Manifest {
  schemaVersion: number;
  scaffolds: Record<string, ManifestEntry>;
}

const MANIFEST = manifestJson as unknown as Manifest;

// Eagerly inline every file under scaffolds/ as a raw string. Vite rewrites
// this at build time so the JS bundle contains the file contents — no runtime
// filesystem access into the source tree is needed.
const SCAFFOLD_SOURCES = import.meta.glob<string>('../scaffolds/**/*.{jsx,css,html,js}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Frames live in a sibling directory and predate the scaffolds bundle. The
// manifest references them via `../frames/<file>`; inline those too so
// `iphone-frame` etc. still resolve post-bundle.
const FRAME_SOURCES = import.meta.glob<string>('../frames/*.jsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function resolveSource(entryPath: string): string | null {
  // entryPath is the manifest's `path` field, e.g. `device-frames/iphone-16-pro.jsx`
  // or `../frames/iphone.jsx`. Normalize to a key matching our glob keys.
  const normalized = entryPath.replace(/^\.\//, '');
  const tryKeys = normalized.startsWith('../frames/')
    ? [normalized, `../${normalized.slice(3)}`]
    : [`../scaffolds/${normalized}`];
  for (const key of tryKeys) {
    const src = SCAFFOLD_SOURCES[key] ?? FRAME_SOURCES[key];
    if (typeof src === 'string') return src;
  }
  return null;
}

export async function loadScaffoldManifest(): Promise<Manifest> {
  return MANIFEST;
}

export async function listScaffoldKinds(): Promise<string[]> {
  return Object.keys(MANIFEST.scaffolds).sort();
}

export interface ScaffoldRequest {
  kind: string;
  /** Workspace-relative destination path. */
  destPath: string;
  /** Workspace absolute root. */
  workspaceRoot: string;
}

export interface ScaffoldResult {
  ok: boolean;
  reason?: string;
  written?: string;
  bytes?: number;
}

export async function runScaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
  const entry = MANIFEST.scaffolds[req.kind];
  if (!entry) return { ok: false, reason: `unknown scaffold kind: ${req.kind}` };

  const source = resolveSource(entry.path);
  if (source === null) {
    return { ok: false, reason: `scaffold source not found for kind ${req.kind} (${entry.path})` };
  }

  const dest = path.resolve(req.workspaceRoot, req.destPath);
  if (!dest.startsWith(req.workspaceRoot)) {
    return { ok: false, reason: 'destination outside workspace' };
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, source, 'utf8');
  return { ok: true, written: dest, bytes: Buffer.byteLength(source, 'utf8') };
}

const ScaffoldParams = Type.Object({
  kind: Type.String({
    minLength: 1,
    description:
      'Manifest key identifying which prebuilt starter to copy. See packages/core/src/scaffolds/manifest.json for the authoritative list.',
  }),
  destPath: Type.String({
    minLength: 1,
    description:
      'Workspace-relative destination path (e.g. "frames/iphone.jsx"). Parent directories are created.',
  }),
});

export type ScaffoldDetails =
  | { ok: true; kind: string; destPath: string; written: string; bytes: number }
  | { ok: false; kind: string; destPath: string; reason: string }
  | { ok: false; reason: string };

export function makeScaffoldTool(
  getWorkspaceRoot: () => string | null | undefined,
): AgentTool<typeof ScaffoldParams, ScaffoldDetails> {
  return {
    name: 'scaffold',
    label: 'Scaffold',
    description:
      "Drop a prebuilt starter file into the current workspace. kind: one of the keys in packages/core/src/scaffolds/manifest.json (device-frame / browser / dev-mockup / ui-primitive / background / surface / deck / landing). destPath: workspace-relative path. Example: scaffold({kind: 'iphone-16-pro-frame', destPath: 'frames/iphone.jsx'}).",
    parameters: ScaffoldParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<ScaffoldDetails>> {
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        const reason = 'no workspace attached to this session';
        return {
          content: [{ type: 'text', text: `scaffold failed: ${reason}` }],
          details: { ok: false, reason },
        };
      }
      const result = await runScaffold({
        kind: params.kind,
        destPath: params.destPath,
        workspaceRoot,
      });
      if (result.ok && result.written && typeof result.bytes === 'number') {
        return {
          content: [
            {
              type: 'text',
              text: `Scaffolded ${params.kind} -> ${result.written} (${result.bytes} bytes)`,
            },
          ],
          details: {
            ok: true,
            kind: params.kind,
            destPath: params.destPath,
            written: result.written,
            bytes: result.bytes,
          },
        };
      }
      const reason = result.reason ?? 'unknown error';
      return {
        content: [{ type: 'text', text: `scaffold failed: ${reason}` }],
        details: {
          ok: false,
          kind: params.kind,
          destPath: params.destPath,
          reason,
        },
      };
    },
  };
}
