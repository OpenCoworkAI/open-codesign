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
import {
  getHtmlAttribute,
  removeCspMetaTags,
  transformHtmlElementBlocks,
} from '@open-codesign/shared/html-utils';

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
const STANDALONE_RUNTIME_MARKER = '<!-- CODESIGN_STANDALONE_RUNTIME -->';
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
    source.includes('EDITMODE-BEGIN') ||
    source.includes('ReactDOM.createRoot') ||
    containsAppDeclaration(source) ||
    containsUppercaseJsxTag(source)
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

function normalizeArtifactSourceReferencePath(reference: string): string | null {
  let normalized = reference.trim().replaceAll('\\', '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    hasWindowsDrivePrefix(normalized) ||
    hasUrlSchemePrefix(normalized)
  ) {
    return null;
  }
  const lower = normalized.toLowerCase();
  if (!isRenderablePath(normalized) || (!lower.endsWith('.jsx') && !lower.endsWith('.tsx'))) {
    return null;
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return null;
  }
  return normalized;
}

function hasWindowsDrivePrefix(value: string): boolean {
  if (value.length < 3) return false;
  const first = value.charCodeAt(0);
  const isLetter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
  return isLetter && value[1] === ':' && value[2] === '/';
}

function hasUrlSchemePrefix(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon <= 0) return false;
  const first = value.charCodeAt(0);
  const firstOk = (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
  if (!firstOk) return false;
  for (let i = 1; i < colon; i += 1) {
    const code = value.charCodeAt(i);
    const ok =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      value[i] === '+' ||
      value[i] === '.' ||
      value[i] === '-';
    if (!ok) return false;
  }
  return true;
}

function isIdentifierBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[A-Za-z0-9_$]/u.test(ch);
}

function containsNamedDeclaration(source: string, name: 'App' | '_App'): boolean {
  for (const keyword of ['function', 'const', 'let']) {
    let index = source.indexOf(keyword);
    while (index >= 0) {
      const before = source[index - 1];
      const after = source[index + keyword.length];
      if (isIdentifierBoundary(before) && isIdentifierBoundary(after)) {
        let cursor = index + keyword.length;
        while (cursor < source.length && source[cursor]?.trim().length === 0) cursor += 1;
        if (
          source.slice(cursor, cursor + name.length) === name &&
          isIdentifierBoundary(source[cursor + name.length])
        ) {
          return true;
        }
      }
      index = source.indexOf(keyword, index + keyword.length);
    }
  }
  return false;
}

function containsAppDeclaration(source: string): boolean {
  return containsNamedDeclaration(source, 'App') || containsNamedDeclaration(source, '_App');
}

function isUppercaseAscii(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90;
}

function containsUppercaseJsxTag(source: string): boolean {
  let index = source.indexOf('<');
  while (index >= 0) {
    if (isUppercaseAscii(source[index + 1])) return true;
    index = source.indexOf('<', index + 1);
  }
  return false;
}

export function findArtifactSourceReference(source: string): string | null {
  let cursor = 0;
  const prefix = 'artifact source lives in';
  while (cursor < source.length) {
    const start = source.indexOf('<!--', cursor);
    if (start < 0) return null;
    const end = source.indexOf('-->', start + 4);
    if (end < 0) return null;
    const body = source.slice(start + 4, end).trim();
    if (body.toLowerCase().startsWith(prefix)) {
      return normalizeArtifactSourceReferencePath(body.slice(prefix.length).trim());
    }
    cursor = end + 3;
  }
  return null;
}

export function resolveArtifactSourceReferencePath(
  currentPath: string,
  reference: string,
): string | null {
  const normalizedReference = normalizeArtifactSourceReferencePath(reference);
  if (normalizedReference === null) return null;
  const normalizedCurrent = currentPath.replaceAll('\\', '/');
  const slash = normalizedCurrent.lastIndexOf('/');
  if (slash === -1) return normalizedReference;
  const base = normalizedCurrent.slice(0, slash);
  return base.length > 0 ? `${base}/${normalizedReference}` : normalizedReference;
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
  return JSON.stringify(jsx).split('</script>').join('<\\/script>');
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
  if (source.includes('ReactDOM.createRoot')) return source;
  const component = containsNamedDeclaration(source, 'App')
    ? 'App'
    : containsNamedDeclaration(source, '_App')
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

function jsxRuntimeComponentScripts(): string {
  return [
    compileAndRunScript(IOS_FRAME_JSX, 'jsx'),
    compileAndRunScript(DESIGN_CANVAS_JSX, 'jsx'),
  ].join('\n');
}

function jsxRuntimeBaseScripts(): string {
  return [
    `<script>${REACT_UMD}</script>`,
    `<script>${REACT_DOM_UMD}</script>`,
    `<script>${BABEL_STANDALONE}</script>`,
    jsxRuntimeComponentScripts(),
  ].join('\n');
}

function wrapJsxAsSrcdoc(
  jsx: string,
  opts: { kind?: 'jsx' | 'tsx'; baseHref?: string | undefined } = {},
): string {
  const kind = opts.kind ?? 'jsx';
  // v0.2 requires canonical EDITMODE markers. `ensureEditmodeMarkers` is kept
  // as a no-op compatibility hook for older call sites.
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
${jsxRuntimeComponentScripts()}
${JSX_TEMPLATE_BEGIN}
${compileAndRunScript(normalized, kind)}
${JSX_TEMPLATE_END}
<script>if(window.__codesign_tweaks__){window.__codesign_tweaks__.originalScript=${agentScriptLiteral};window.__codesign_tweaks__.transformOptions=${transformOptionsLiteral};}</script>
<script>${TWEAKS_BRIDGE_LISTENER}</script>
<script>${OVERLAY_SCRIPT}</script>
</body>
</html>`;
}

function wrapJsxAsStandaloneDocument(
  jsx: string,
  opts: { kind?: 'jsx' | 'tsx'; baseHref?: string | undefined } = {},
): string {
  const kind = opts.kind ?? 'jsx';
  const normalized = autoMountJsxIfNeeded(ensureEditmodeMarkers(jsx));
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
${STANDALONE_RUNTIME_MARKER}
${jsxRuntimeBaseScripts()}
${compileAndRunScript(normalized, kind)}
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
    hasTextBabelScript(html) ||
    html.includes('ReactDOM.createRoot') ||
    html.includes('React.createElement') ||
    html.includes('IOSDevice') ||
    html.includes('DesignCanvas') ||
    html.includes('AppleWatchUltra') ||
    html.includes('AndroidPhone') ||
    html.includes('MacOSSafari')
  );
}

function hasTextBabelScript(html: string): boolean {
  let found = false;
  transformHtmlElementBlocks(html, 'script', ({ attrs, tag }) => {
    if (getHtmlAttribute(attrs, 'type')?.toLowerCase() === 'text/babel') found = true;
    return tag;
  });
  return found;
}

function jsxRuntimeScripts(): string {
  return [
    `<script>${REACT_UMD}</script>`,
    `<script>${REACT_DOM_UMD}</script>`,
    `<script>${BABEL_STANDALONE}</script>`,
    `<script>${TWEAKS_BRIDGE_SETUP}</script>`,
    jsxRuntimeComponentScripts(),
  ].join('\n');
}

function stripHostJsxRuntimeScripts(html: string): string {
  return transformHtmlElementBlocks(html, 'script', ({ attrs, tag }) => {
    const rawSrc = getHtmlAttribute(attrs, 'src');
    if (rawSrc === null) return tag;
    let url: URL;
    try {
      url = new URL(rawSrc);
    } catch {
      return tag;
    }
    return isKnownHostJsxRuntimePath(url.pathname) ? '' : tag;
  });
}

function isKnownHostJsxRuntimePath(path: string): boolean {
  const parts = path.toLowerCase().split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  const pkg = parts[parts.length - 3] ?? '';
  if (parent === 'umd' && pkg.startsWith('react@')) {
    return last === 'react.development.js' || last === 'react.production.min.js';
  }
  if (parent === 'umd' && pkg.startsWith('react-dom@')) {
    return last === 'react-dom.development.js' || last === 'react-dom.production.min.js';
  }
  return last === 'babel.min.js' && parts.some((part) => part.startsWith('@babel'));
}

function inlineScriptLooksLikeJsx(scriptBody: string): boolean {
  return (
    scriptBody.includes('ReactDOM.createRoot') &&
    (scriptBody.includes('.render(<') ||
      scriptBody.includes('return (<') ||
      scriptBody.includes('return <') ||
      containsUppercaseJsxTag(scriptBody))
  );
}

function markInlineJsxScriptsAsBabel(html: string): string {
  return transformHtmlElementBlocks(html, 'script', ({ attrs, body, tag }) => {
    if (getHtmlAttribute(attrs, 'src') !== null || getHtmlAttribute(attrs, 'type') !== null) {
      return tag;
    }
    if (!inlineScriptLooksLikeJsx(body)) return tag;
    return `<script type="text/babel"${attrs}>${body}</script>`;
  });
}

function injectJsxRuntimeIntoHtml(html: string): string {
  if (html.includes(JSX_RUNTIME_MARKER)) return html;
  const cleaned = markInlineJsxScriptsAsBabel(stripHostJsxRuntimeScripts(html));
  const stack = `${JSX_RUNTIME_MARKER}\n${jsxRuntimeScripts()}`;
  // Insert at the very top of <body> so user's own `<script type="text/babel">`
  // tags (which typically sit inside <body>) see React/Babel already loaded.
  if (/<body[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/(<body[^>]*>)/i, (_match, open: string) => `${open}\n${stack}`);
  }
  if (/<\/head>/i.test(cleaned)) {
    return cleaned.replace(/(<\/head>)/i, (close) => `${stack}\n${close}`);
  }
  return `${stack}\n${cleaned}`;
}

function injectStandaloneJsxRuntimeIntoHtml(html: string): string {
  if (html.includes(STANDALONE_RUNTIME_MARKER)) return html;
  const cleaned = markInlineJsxScriptsAsBabel(stripHostJsxRuntimeScripts(html));
  const stack = `${STANDALONE_RUNTIME_MARKER}\n${jsxRuntimeBaseScripts()}`;
  if (/<body[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/(<body[^>]*>)/i, (_match, open: string) => `${open}\n${stack}`);
  }
  if (/<\/head>/i.test(cleaned)) {
    return cleaned.replace(/(<\/head>)/i, (close) => `${stack}\n${close}`);
  }
  return `${stack}\n${cleaned}`;
}

function injectOverlayIntoHtmlDocument(html: string): string {
  if (html.includes(OVERLAY_MARKER) || html.includes("type: 'ELEMENT_SELECTED'")) {
    return html;
  }
  const script = overlayScriptTag();
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, () => `${script}</body>`);
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, () => `${script}</html>`);
  }
  return `${html}${script}`;
}

const PREVIEW_VIEWPORT_MARKER = '<!-- OPEN-CODESIGN-PREVIEW-VIEWPORT -->';

function previewViewportSupportTags(): string {
  return `${PREVIEW_VIEWPORT_MARKER}
<meta name="viewport" content="width=device-width, initial-scale=1.0" data-open-codesign="viewport" />
<style data-open-codesign="preview-viewport">:root{--codesign-preview-width:100vw;--codesign-preview-height:100vh;}*,*::before,*::after{box-sizing:border-box;}html,body{max-width:100%;}</style>
<script data-open-codesign="preview-viewport">
(() => {
  const sync = () => {
    document.documentElement.style.setProperty('--codesign-preview-width', \`\${window.innerWidth}px\`);
    document.documentElement.style.setProperty('--codesign-preview-height', \`\${window.innerHeight}px\`);
  };
  sync();
  window.addEventListener('resize', sync, { passive: true });
})();
</script>`;
}

function injectPreviewViewportSupportIntoHtmlDocument(html: string): string {
  if (html.includes(PREVIEW_VIEWPORT_MARKER)) return html;
  const tags = previewViewportSupportTags();
  const hasViewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  const support = hasViewport
    ? tags.replace(
        /<meta name="viewport" content="width=device-width, initial-scale=1\.0" data-open-codesign="viewport" \/>\n/,
        '',
      )
    : tags;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, (close) => `${support}\n${close}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1\n<head>\n${support}\n</head>`);
  }
  return `${support}\n${html}`;
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
  const stripped = removeCspMetaTags(userSource);
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
      injectPreviewViewportSupportIntoHtmlDocument(
        injectBaseHrefIntoHtmlDocument(withRuntime, opts.baseHref),
      ),
    );
  }

  return wrapJsxAsSrcdoc(stripped, { kind, baseHref: opts.baseHref });
}

function ensureStandaloneShell(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed)) return trimmed;
  if (/<html[\s>]/i.test(trimmed)) return `<!doctype html>\n${trimmed}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
${trimmed}
</body>
</html>`;
}

export function buildStandaloneDocument(
  userSource: string,
  opts: BuildPreviewDocumentOptions = {},
): string {
  const stripped = removeCspMetaTags(userSource);
  const classified = classifyRenderableSource(stripped, opts.path);
  const kind = classified === 'unknown' && opts.path === undefined ? 'jsx' : classified;
  if (kind === 'unknown') {
    return injectBaseHrefIntoHtmlDocument(ensureStandaloneShell(stripped), opts.baseHref);
  }
  if (kind === 'html') {
    const html = needsJsxRuntimeInHtml(stripped)
      ? injectStandaloneJsxRuntimeIntoHtml(stripped)
      : stripped;
    return injectBaseHrefIntoHtmlDocument(ensureStandaloneShell(html), opts.baseHref);
  }
  return wrapJsxAsStandaloneDocument(stripped, { kind, baseHref: opts.baseHref });
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
