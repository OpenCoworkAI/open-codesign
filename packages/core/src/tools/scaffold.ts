import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

/**
 * `scaffold` tool. Copies a prebuilt starter file from the user-visible
 * templates tree (`<userData>/templates/scaffolds/`) into the current
 * workspace. The templates directory is seeded from the app bundle on first
 * boot and owned by the user afterwards, so edits to the manifest or file
 * contents persist across launches.
 *
 * All filesystem paths come from `getScaffoldsRoot()` — no package-relative
 * resolution, no `import.meta.url`. That keeps the tool working after
 * electron-vite bundles `packages/core` into a single file, and lets tests
 * seed a tmpdir without touching the user's real templates.
 */

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

export async function loadScaffoldManifest(scaffoldsRoot: string): Promise<Manifest> {
  const manifestPath = path.join(scaffoldsRoot, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw) as Manifest;
}

export async function listScaffoldKinds(scaffoldsRoot: string): Promise<string[]> {
  const manifest = await loadScaffoldManifest(scaffoldsRoot);
  return Object.keys(manifest.scaffolds).sort();
}

export interface ScaffoldRequest {
  kind: string;
  destPath: string;
  workspaceRoot: string;
  scaffoldsRoot: string;
}

export interface ScaffoldResult {
  ok: boolean;
  reason?: string;
  written?: string;
  bytes?: number;
}

export async function runScaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
  let manifest: Manifest;
  try {
    manifest = await loadScaffoldManifest(req.scaffoldsRoot);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `scaffold manifest unavailable: ${reason}` };
  }
  const entry = manifest.scaffolds[req.kind];
  if (!entry) return { ok: false, reason: `unknown scaffold kind: ${req.kind}` };

  const source = path.resolve(req.scaffoldsRoot, entry.path);
  let contents: string;
  try {
    contents = await readFile(source, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `scaffold source not found for kind ${req.kind} (${entry.path}): ${reason}`,
    };
  }

  const dest = path.resolve(req.workspaceRoot, req.destPath);
  if (!dest.startsWith(req.workspaceRoot)) {
    return { ok: false, reason: 'destination outside workspace' };
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, contents, 'utf8');
  return { ok: true, written: dest, bytes: Buffer.byteLength(contents, 'utf8') };
}

const ScaffoldParams = Type.Object({
  kind: Type.String({
    minLength: 1,
    description:
      "Manifest key identifying which prebuilt starter to copy. Keys live in <userData>/templates/scaffolds/manifest.json (user-editable). Open via Settings → 'Open templates folder'.",
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
  getScaffoldsRoot: () => string | null | undefined,
): AgentTool<typeof ScaffoldParams, ScaffoldDetails> {
  return {
    name: 'scaffold',
    label: 'Scaffold',
    description:
      "Drop a prebuilt starter file into the current workspace. kind: one of the keys in <userData>/templates/scaffolds/manifest.json (device-frame / browser / dev-mockup / ui-primitive / background / surface / deck / landing). destPath: workspace-relative path. Example: scaffold({kind: 'iphone-16-pro-frame', destPath: 'frames/iphone.jsx'}).",
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
      const scaffoldsRoot = getScaffoldsRoot();
      if (!scaffoldsRoot) {
        const reason = 'scaffolds directory not configured for this session';
        return {
          content: [{ type: 'text', text: `scaffold failed: ${reason}` }],
          details: { ok: false, reason },
        };
      }
      const result = await runScaffold({
        kind: params.kind,
        destPath: params.destPath,
        workspaceRoot,
        scaffoldsRoot,
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
