import { readFile } from 'node:fs/promises';

// Vite normally turns these five vendored assets into strings. The Node host
// supplies the same strings without evaluating browser code or loading Vite.
const assets = new Set(
  [
    'babel.standalone.js',
    'design-canvas.jsx',
    'ios-frame.jsx',
    'react.umd.js',
    'react-dom.umd.js',
  ].map((name) => new URL(`../../../packages/runtime/vendor/${name}?raw`, import.meta.url).href),
);

export async function load(url, context, nextLoad) {
  if (!assets.has(url)) return nextLoad(url, context);
  return {
    format: 'module',
    shortCircuit: true,
    source: `export default ${JSON.stringify(await readFile(new URL(url), 'utf8'))};`,
  };
}
