import { type Static, Type } from '@sinclair/typebox';

/**
 * Cross-file tweak block scanner (T3.5).
 *
 * v0.1 supported single-file EDITMODE blocks. v0.2 lets a design span
 * multiple files (landing.html + dashboard.jsx + tokens.css) and the
 * tweaks panel must aggregate tweakable values across all of them.
 *
 * Wire format: each block carries the file it lives in plus the keys
 * it exposes; the runtime layer (packages/runtime/src/tweaks-bridge)
 * resolves these into postMessage handlers when the iframe loads.
 */

const EDITMODE_BLOCK_RE = /\/\*\s*EDITMODE\s+([\s\S]*?)\s*EDITMODE_END\s*\*\//g;
const KEY_RE = /^\s*([A-Za-z_][\w-]*)\s*:\s*([^\n;]+)\s*;?\s*$/;

export const TweakKey = Type.Object({
  name: Type.String(),
  value: Type.String(),
});
export type TweakKey = Static<typeof TweakKey>;

export const TweakBlock = Type.Object({
  file: Type.String(),
  keys: Type.Array(TweakKey),
});
export type TweakBlock = Static<typeof TweakBlock>;

export interface ParseSourceFile {
  file: string;
  contents: string;
}

export function parseTweakBlocks(sources: Iterable<ParseSourceFile>): TweakBlock[] {
  const out: TweakBlock[] = [];
  for (const { file, contents } of sources) {
    let match: RegExpExecArray | null = null;
    EDITMODE_BLOCK_RE.lastIndex = 0;
    while (true) {
      match = EDITMODE_BLOCK_RE.exec(contents);
      if (!match) break;
      const body = match[1] ?? '';
      const keys: TweakKey[] = [];
      for (const line of body.split(/\r?\n/)) {
        const kv = KEY_RE.exec(line);
        if (kv?.[1] && kv[2] !== undefined) {
          keys.push({ name: kv[1], value: kv[2].trim() });
        }
      }
      if (keys.length > 0) out.push({ file, keys });
    }
  }
  return out;
}

export function aggregateTweaks(blocks: TweakBlock[]): Map<string, TweakKey[]> {
  const byFile = new Map<string, TweakKey[]>();
  for (const block of blocks) {
    const existing = byFile.get(block.file) ?? [];
    existing.push(...block.keys);
    byFile.set(block.file, existing);
  }
  return byFile;
}
