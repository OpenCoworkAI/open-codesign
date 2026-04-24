import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Device frame starter templates — JSX modules built against the runtime's
 * pre-loaded React + IOSDevice / DesignCanvas globals. The agent can `view`
 * one of these from the virtual filesystem and adapt it as the basis for a
 * mobile / tablet / watch design.
 *
 * Files live in `<userData>/templates/frames/` (seeded from the app bundle
 * on first boot, user-editable afterwards). Each .jsx file is a complete
 * `<script type="text/babel">` payload; the `TWEAK_DEFAULTS` EDITMODE block
 * at the top lets the host render a tweak panel.
 */

export const FRAME_FILES = [
  'iphone.jsx',
  'ipad.jsx',
  'watch.jsx',
  'android.jsx',
  'macos-safari.jsx',
] as const;

export type FrameName = (typeof FRAME_FILES)[number];

/**
 * Read every known frame file from the given directory, skipping entries
 * the user has deleted. Returns `[name, contents]` pairs in the canonical
 * order defined by `FRAME_FILES`.
 */
export async function loadFrameTemplates(dir: string): Promise<Array<[string, string]>> {
  const results = await Promise.all(
    FRAME_FILES.map(async (name): Promise<[string, string] | null> => {
      try {
        const contents = await readFile(path.join(dir, name), 'utf8');
        return [name, contents];
      } catch {
        return null;
      }
    }),
  );
  return results.filter((entry): entry is [string, string] => entry !== null);
}
