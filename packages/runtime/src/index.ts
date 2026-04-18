import { OVERLAY_SCRIPT } from './overlay';

export { OVERLAY_SCRIPT, isOverlayMessage } from './overlay';
export type { OverlayMessage } from './overlay';
export { isIframeErrorMessage } from './iframe-errors';
export type { IframeErrorMessage } from './iframe-errors';

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
    return stripped.replace(
      /<\/body\s*>(?![\s\S]*<\/body\s*>)/i,
      `<script>${OVERLAY_SCRIPT}</script></body>`,
    );
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body{margin:0;padding:0;font-family:system-ui,sans-serif;}</style>
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
