/**
 * Sandbox runtime for preview iframes.
 *
 * `buildSrcdoc` preserves the original artifact-generation contract: a bare
 * JSX module is wrapped in vendored React + ReactDOM + @babel/standalone, while
 * full HTML documents stay HTML and receive preview overlay/runtime injection
 * only when needed.
 *
 * `buildPreviewDocument` is the workspace-file entry point. It classifies
 * `.html`, `.jsx`, and `.tsx` sources, wraps standalone React snippets through
 * the same runtime, and can inject a workspace `baseHref` for relative assets.
 */

import { ensureEditmodeMarkers } from '@open-codesign/shared';

import BABEL_STANDALONE from '../vendor/babel.standalone.js?raw';
import DESIGN_CANVAS_JSX from '../vendor/design-canvas.jsx?raw';
import IOS_FRAME_JSX from '../vendor/ios-frame.jsx?raw';
import REACT_UMD from '../vendor/react.umd.js?raw';
import REACT_DOM_UMD from '../vendor/react-dom.umd.js?raw';

import { OVERLAY_SCRIPT } from './overlay';
import { TWEAKS_BRIDGE_LISTENER, TWEAKS_BRIDGE_SETUP } from './tweaks-bridge';

export type { IframeErrorMessage } from './iframe-errors';
export { isIframeErrorMessage } from './iframe-errors';
export type { ElementRectsMessage, OverlayMessage } from './overlay';
export { isElementRectsMessage, isOverlayMessage, OVERLAY_SCRIPT } from './overlay';

const JSX_TEMPLATE_BEGIN = '<!-- AGENT_BODY_BEGIN -->';
const JSX_TEMPLATE_END = '<!-- AGENT_BODY_END -->';
const OVERLAY_MARKER = '<!-- CODESIGN_OVERLAY_SCRIPT -->';
const JSX_RUNTIME_MARKER = '<!-- CODESIGN_JSX_RUNTIME -->';

export type RenderableSourceKind = 'html' | 'jsx' | 'tsx' | 'unknown';

export interface BuildPreviewDocumentOptions {
  /** Workspace-relative path, used to classify .jsx/.tsx/.html files. */
  path?: string | undefined;
  /** Optional absolute file:// base URL so relative assets resolve in srcdoc/data URLs. */
  baseHref?: string | undefined;
}

function extensionKind(path: string | undefined): RenderableSourceKind {
  const lower = path?.toLowerCase() ?? '';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return 'unknown';
}

function looksLikeFullHtmlDocument(source: string): boolean {
  const head = source.trimStart().slice(0, 2048).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function looksLikeJsxSource(source: string): boolean {
  return (
    source.includes(JSX_TEMPLATE_BEGIN) ||
    /EDITMODE-BEGIN/.test(source) ||
    /\bReactDOM\.createRoot\s*\(/.test(source) ||
    /(?:^|\n)\s*(?:function|const|let)\s+_?App\b/.test(source) ||
    /<[A-Z][A-Za-z0-9]*(?:\s|>|\/)/.test(source)
  );
}

export function classifyRenderableSource(
  source: string,
  path?: string | undefined,
): RenderableSourceKind {
  const ext = extensionKind(path);
  if (ext === 'tsx') return 'tsx';
  if (ext === 'jsx') return 'jsx';
  if (looksLikeFullHtmlDocument(source)) return 'html';
  if (looksLikeJsxSource(source)) return 'jsx';
  if (ext === 'html') return 'html';
  return 'unknown';
}

export function isRenderableSourceKind(kind: RenderableSourceKind): kind is 'html' | 'jsx' | 'tsx' {
  return kind === 'html' || kind === 'jsx' || kind === 'tsx';
}

export function isRenderablePath(path: string): boolean {
  return isRenderableSourceKind(extensionKind(path));
}

export function requiresPreviewScripts(source: string, path?: string | undefined): boolean {
  const kind = classifyRenderableSource(source, path);
  if (kind === 'jsx' || kind === 'tsx') return true;
  if (kind === 'html') return needsJsxRuntimeInHtml(source);
  return false;
}

function escapeForScriptLiteral(jsx: string): string {
  // JSON.stringify handles quotes/newlines; the </script> escape prevents the
  // outer <script> from being closed early if the agent's source happens to
  // contain that literal string.
  return JSON.stringify(jsx).replace(/<\/script>/g, '<\\/script>');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function baseTag(baseHref: string | undefined): string {
  return baseHref ? `<base href="${escapeHtmlAttr(baseHref)}" />\n` : '';
}

function autoMountJsxIfNeeded(source: string): string {
  if (/\bReactDOM\.createRoot\s*\(/.test(source)) return source;
  const component = /(?:^|\n)\s*(?:function|const|let)\s+App\b/.test(source)
    ? 'App'
    : /(?:^|\n)\s*(?:function|const|let)\s+_App\b/.test(source)
      ? '_App'
      : null;
  if (component === null) return source;
  return `${source.trimEnd()}\n\nReactDOM.createRoot(document.getElementById('root')).render(<${component} />);`;
}

function transformOptionsForKind(kind: 'jsx' | 'tsx'): { presets: unknown[]; filename: string } {
  if (kind === 'tsx') {
    return {
      filename: 'artifact.tsx',
      presets: [['typescript', { allExtensions: true, isTSX: true }], 'react'],
    };
  }
  return { filename: 'artifact.jsx', presets: ['react'] };
}

function compileAndRunScript(source: string, kind: 'jsx' | 'tsx'): string {
  const sourceLiteral = escapeForScriptLiteral(source);
  const optionsLiteral = JSON.stringify(transformOptionsForKind(kind));
  return `<script>
(function() {
  var source = ${sourceLiteral};
  var options = ${optionsLiteral};
  try {
    var compiled = window.Babel.transform(source, options).code;
    new Function('React', 'ReactDOM', compiled)(window.React, window.ReactDOM);
  } catch (err) {
    setTimeout(function() { throw err; }, 0);
  }
})();
</script>`;
}

function wrapJsxAsSrcdoc(
  jsx: string,
  opts: { kind?: 'jsx' | 'tsx'; baseHref?: string | undefined } = {},
): string {
  // Auto-recover bare `const TWEAK_DEFAULTS = {...}` (no markers) into the
  // canonical EDITMODE form before embedding, so the in-iframe bridge regex
  // always matches and live tweaks work even on agent output that forgot the
  // markers. Side-benefit: TweakPanel's parser sees the same canonical form.
  const kind = opts.kind ?? 'jsx';
  const normalized = autoMountJsxIfNeeded(ensureEditmodeMarkers(jsx));
  // The boundary markers let us round-trip extract the agent's payload from
  // a fully-built srcdoc later (used by EDITMODE replace flows).
  const agentScriptLiteral = escapeForScriptLiteral(normalized);
  const transformOptionsLiteral = JSON.stringify(transformOptionsForKind(kind));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${baseTag(opts.baseHref)}<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300;1,9..144,400&family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}html,body,#root{height:100%;}body{font-family:'DM Sans',system-ui,sans-serif;background:var(--color-artifact-bg, #ffffff);}</style>
</head>
<body>
<div id="root"></div>
<script>${REACT_UMD}</script>
<script>${REACT_DOM_UMD}</script>
<script>${BABEL_STANDALONE}</script>
<script>${TWEAKS_BRIDGE_SETUP}</script>
<script type="text/babel" data-presets="react">${IOS_FRAME_JSX}</script>
<script type="text/babel" data-presets="react">${DESIGN_CANVAS_JSX}</script>
${JSX_TEMPLATE_BEGIN}
${compileAndRunScript(normalized, kind)}
${JSX_TEMPLATE_END}
<script>if(window.__codesign_tweaks__){window.__codesign_tweaks__.originalScript=${agentScriptLiteral};window.__codesign_tweaks__.transformOptions=${transformOptionsLiteral};}</script>
<script>${TWEAKS_BRIDGE_LISTENER}</script>
<script>${OVERLAY_SCRIPT}</script>
</body>
</html>`;
}

function overlayScriptTag(): string {
  return `${OVERLAY_MARKER}<script>${OVERLAY_SCRIPT}</script>`;
}

// HTML payloads authored by the agent occasionally mix a `<!doctype html>`
// shell with Babel-transpiled JSX inside (`<script type="text/babel">`) or
// references to the window-scoped component library (IOSDevice, DesignCanvas,
// …). Without the React + Babel stack those references die silently and the
// iframe renders blank — the model then misdiagnoses this as "Babel missing"
// and rewrites everything in plain HTML. Detecting the mixed-mode case and
// injecting the same runtime the JSX branch uses keeps both authoring styles
// viable; pure HTML + CDN-library pages (Chart.js etc.) match no signal and
// pay zero inline-script cost.
function needsJsxRuntimeInHtml(html: string): boolean {
  return (
    /<script[^>]*type=["']text\/babel["']/i.test(html) ||
    /\bReactDOM\.createRoot\b/.test(html) ||
    /\bReact\.createElement\b/.test(html) ||
    /\bIOSDevice\b/.test(html) ||
    /\bDesignCanvas\b/.test(html) ||
    /\bAppleWatchUltra\b/.test(html) ||
    /\bAndroidPhone\b/.test(html) ||
    /\bMacOSSafari\b/.test(html)
  );
}

function jsxRuntimeScripts(): string {
  return [
    `<script>${REACT_UMD}</script>`,
    `<script>${REACT_DOM_UMD}</script>`,
    `<script>${BABEL_STANDALONE}</script>`,
    `<script>${TWEAKS_BRIDGE_SETUP}</script>`,
    `<script type="text/babel" data-presets="react">${IOS_FRAME_JSX}</script>`,
    `<script type="text/babel" data-presets="react">${DESIGN_CANVAS_JSX}</script>`,
  ].join('\n');
}

function injectJsxRuntimeIntoHtml(html: string): string {
  if (html.includes(JSX_RUNTIME_MARKER)) return html;
  const stack = `${JSX_RUNTIME_MARKER}\n${jsxRuntimeScripts()}`;
  // Insert at the very top of <body> so user's own `<script type="text/babel">`
  // tags (which typically sit inside <body>) see React/Babel already loaded.
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/(<body[^>]*>)/i, `$1\n${stack}`);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/(<\/head>)/i, `${stack}\n$1`);
  }
  return `${stack}\n${html}`;
}

function injectOverlayIntoHtmlDocument(html: string): string {
  if (html.includes(OVERLAY_MARKER) || html.includes("type: 'ELEMENT_SELECTED'")) {
    return html;
  }
  const script = overlayScriptTag();
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${script}</body>`);
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, `${script}</html>`);
  }
  return `${html}${script}`;
}

function injectBaseHrefIntoHtmlDocument(html: string, baseHref: string | undefined): string {
  if (!baseHref || /<base\s/i.test(html)) return html;
  const tag = baseTag(baseHref).trimEnd();
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1\n<head>\n${tag}\n</head>`);
  }
  return `${tag}\n${html}`;
}

/**
 * Wrap an agent artifact in the vendored React + Babel skeleton, ready for
 * use as an iframe `srcdoc`. Already-wrapped payloads pass through unchanged.
 */
export function extractAndUpgradeArtifact(source: string): string {
  if (source.includes(JSX_TEMPLATE_BEGIN)) return source;
  return wrapJsxAsSrcdoc(source);
}

export function buildPreviewDocument(
  userSource: string,
  opts: BuildPreviewDocumentOptions = {},
): string {
  const stripped = userSource.replace(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    '',
  );
  // Already-wrapped srcdoc (round-trip safe). When the workspace preview path
  // supplies a base URL, inject it once so relative assets still resolve.
  if (stripped.includes(JSX_TEMPLATE_BEGIN)) {
    return injectBaseHrefIntoHtmlDocument(stripped, opts.baseHref);
  }

  const classified = classifyRenderableSource(stripped, opts.path);
  const kind = classified === 'unknown' && opts.path === undefined ? 'jsx' : classified;
  if (kind === 'unknown') {
    throw new Error(`Unsupported preview file type: ${opts.path ?? 'unknown'}`);
  }

  if (kind === 'html') {
    const withRuntime = needsJsxRuntimeInHtml(stripped)
      ? injectJsxRuntimeIntoHtml(stripped)
      : stripped;
    return injectOverlayIntoHtmlDocument(
      injectBaseHrefIntoHtmlDocument(withRuntime, opts.baseHref),
    );
  }

  return wrapJsxAsSrcdoc(stripped, { kind, baseHref: opts.baseHref });
}

/**
 * Build a complete srcdoc HTML string for the preview iframe. Strips any
 * stray CSP meta tags from the agent payload, then wraps it as JSX.
 *
 * Legacy-HTML compatibility: snapshots created before the JSX-only switchover
 * stored raw HTML documents (starting with `<!doctype` or `<html>`). Feeding
 * these through `wrapJsxAsSrcdoc` produces "Unexpected token" errors because
 * Babel tries to parse the HTML as JSX. Detect and pass them through verbatim.
 */
export function buildSrcdoc(userSource: string): string {
  return buildPreviewDocument(userSource);
}
