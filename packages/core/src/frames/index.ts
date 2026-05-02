/**
 * Device frame starter templates — JSX modules built against the runtime's
 * pre-loaded React + IOSDevice / DesignCanvas globals. The agent can `view`
 * one of these from the virtual filesystem and adapt it as the basis for a
 * mobile / tablet / watch design.
 *
 * Each .jsx file is a complete `<script type="text/babel">` payload (the
 * runtime wraps it in the React + Babel template). Keep the `TWEAK_DEFAULTS`
 * EDITMODE block at the top so the host can render a tweak panel.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFrame(name: string): string {
  return readFileSync(resolve(__dirname, name), 'utf-8');
}

const FRAME_FILES = [
  'iphone.jsx',
  'ipad.jsx',
  'watch.jsx',
  'android.jsx',
  'macos-safari.jsx',
] as const;

export type FrameName = (typeof FRAME_FILES)[number];

export const FRAME_TEMPLATES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['iphone.jsx', loadFrame('iphone.jsx')],
  ['ipad.jsx', loadFrame('ipad.jsx')],
  ['watch.jsx', loadFrame('watch.jsx')],
  ['android.jsx', loadFrame('android.jsx')],
  ['macos-safari.jsx', loadFrame('macos-safari.jsx')],
] as const);
