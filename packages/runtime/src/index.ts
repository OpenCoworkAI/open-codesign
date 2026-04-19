import { OVERLAY_SCRIPT } from './overlay';

export { OVERLAY_SCRIPT, isOverlayMessage } from './overlay';
export type { OverlayMessage } from './overlay';
export { isIframeErrorMessage } from './iframe-errors';
export type { IframeErrorMessage } from './iframe-errors';

/**
 * Baseline white background so the iframe falls back to a neutral surface
 * when the artifact doesn't set its own body background. Injected before the
 * artifact's own styles so any explicit `body { background: ... }` in the
 * artifact wins via cascade order.
 */
const BASELINE_STYLE =
  '<style>html,body{margin:0;padding:0;background:#ffffff;min-height:100%;}</style>';

/**
 * Build a complete srcdoc HTML string for the preview iframe.
 * Strips CSP <meta> tags from user content to allow overlay injection.
 *
 * Tier 1: assumes user content is full HTML document or fragment.
 * Tier 2 will inject Tailwind via local stylesheet, esbuild-wasm hooks, etc.
 */
export function buildSrcdoc(userHtml: string): string {
  const stripped = userHtml.replace(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    '',
  );

  if (/<\/body\s*>/i.test(stripped)) {
    const withBaseline = /<head[^>]*>/i.test(stripped)
      ? stripped.replace(/<head[^>]*>/i, (match) => `${match}${BASELINE_STYLE}`)
      : stripped.replace(/<html[^>]*>/i, (match) => `${match}<head>${BASELINE_STYLE}</head>`);
    return withBaseline.replace(
      /<\/body\s*>(?![\s\S]*<\/body\s*>)/i,
      `<script>${OVERLAY_SCRIPT}</script></body>`,
    );
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${BASELINE_STYLE}
<style>html,body{font-family:system-ui,sans-serif;}</style>
</head>
<body>
${stripped}
<script>${OVERLAY_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Apply a CSS-variable update inside the iframe without re-rendering the document.
 * Caller passes the iframe's contentDocument.
 */
export function applyCssVar(iframeDoc: Document, cssVar: string, value: string): void {
  iframeDoc.documentElement.style.setProperty(cssVar, value);
}
