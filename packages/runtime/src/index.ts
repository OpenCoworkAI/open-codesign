import { OVERLAY_SCRIPT } from './overlay';

export { OVERLAY_SCRIPT, isOverlayMessage } from './overlay';
export type { OverlayMessage } from './overlay';
export { isIframeErrorMessage } from './iframe-errors';
export type { IframeErrorMessage } from './iframe-errors';

/**
 * Baseline background so the iframe falls back to a neutral surface when the
 * artifact doesn't set its own body background. Sourced from the
 * `--color-artifact-bg` design token (packages/ui), with a `#ffffff` fallback
 * for sandboxed contexts where the parent's CSS vars aren't propagated.
 * Injected before the artifact's own styles so any explicit
 * `body { background: ... }` in the artifact wins via cascade order.
 */
const BASELINE_STYLE =
  '<style>html,body{margin:0;padding:0;background:var(--color-artifact-bg, #ffffff);min-height:100%;}</style>';

const HTML_RE = /<html[^>]*>/i;
const HEAD_OPEN_RE = /<head[^>]*>/i;
const HEAD_CLOSE_RE = /<\/head\s*>/i;
const BODY_OPEN_RE = /<body[^>]*>/i;
const BODY_CLOSE_RE = /<\/body\s*>/i;

/**
 * Ensure the document has matching <body>...</body> tags so downstream
 * baseline/overlay injection can rely on them. Handles all four input
 * shapes: both tags, opener only, closer only, neither.
 */
function normalizeBodyTags(html: string): string {
  const hasOpen = BODY_OPEN_RE.test(html);
  const hasClose = BODY_CLOSE_RE.test(html);

  if (hasOpen && hasClose) return html;

  if (hasOpen && !hasClose) {
    return `${html}</body>`;
  }

  if (!hasOpen && hasClose) {
    if (HEAD_CLOSE_RE.test(html)) {
      return html.replace(HEAD_CLOSE_RE, (m) => `${m}<body>`);
    }
    if (HTML_RE.test(html)) {
      return html.replace(HTML_RE, (m) => `${m}<body>`);
    }
    return `<body>${html}`;
  }

  // Neither opener nor closer.
  if (HEAD_CLOSE_RE.test(html)) {
    return `${html.replace(HEAD_CLOSE_RE, (m) => `${m}<body>`)}</body>`;
  }
  if (HTML_RE.test(html)) {
    return `${html.replace(HTML_RE, (m) => `${m}<body>`)}</body>`;
  }
  return `<body>${html}</body>`;
}

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

  const hasAnyStructure =
    HTML_RE.test(stripped) ||
    HEAD_OPEN_RE.test(stripped) ||
    BODY_OPEN_RE.test(stripped) ||
    BODY_CLOSE_RE.test(stripped);

  if (!hasAnyStructure) {
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

  const normalized = normalizeBodyTags(stripped);

  let withBaseline: string;
  if (HEAD_OPEN_RE.test(normalized)) {
    withBaseline = normalized.replace(HEAD_OPEN_RE, (match) => `${match}${BASELINE_STYLE}`);
  } else if (HTML_RE.test(normalized)) {
    withBaseline = normalized.replace(
      HTML_RE,
      (match) => `${match}<head>${BASELINE_STYLE}</head>`,
    );
  } else {
    withBaseline = `<html><head>${BASELINE_STYLE}</head>${normalized}</html>`;
  }

  return withBaseline.replace(
    /<\/body\s*>(?![\s\S]*<\/body\s*>)/i,
    `<script>${OVERLAY_SCRIPT}</script></body>`,
  );
}

/**
 * Apply a CSS-variable update inside the iframe without re-rendering the document.
 * Caller passes the iframe's contentDocument.
 */
export function applyCssVar(iframeDoc: Document, cssVar: string, value: string): void {
  iframeDoc.documentElement.style.setProperty(cssVar, value);
}
