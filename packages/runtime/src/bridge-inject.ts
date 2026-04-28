/**
 * Bridge injection for engineering-mode preview iframes.
 *
 * In v0.2 engineering mode the iframe points at the user's running dev
 * server (e.g. `http://localhost:5173`) instead of a srcdoc-built sandbox.
 * The PreviewPane needs the same selection / rect-tracking / error-reporting
 * protocol the sandbox provides — so we inject the same `OVERLAY_SCRIPT`
 * IIFE into the live page after each load.
 *
 * This only works because:
 *  - the iframe is sandboxed with `allow-same-origin allow-scripts` and
 *  - the dev server is on `localhost`, which the parent page can therefore
 *    reach into via `iframe.contentDocument`.
 *
 * Re-injecting on every load is intentional: a hard reload (full HMR
 * fallback, manual refresh, navigation) blows away the previous overlay.
 *
 * The DOM types are declared structurally rather than imported from the
 * `dom` lib so this file is safe to transitively include from the
 * Electron main-process build (which only ships ES2023 + node types).
 */

import { OVERLAY_SCRIPT } from './overlay';

/** Tracks which documents we've already injected into during their lifetime. */
const injectedDocuments = new WeakSet<object>();

/** Minimal structural shape of a script element we need to mutate. */
interface ScriptLike {
  textContent: string | null;
}
/** Minimal structural shape of an element we can append the script to. */
interface AppendTarget {
  appendChild(node: ScriptLike): unknown;
}
/** Minimal structural shape of the iframe document. */
interface DocumentLike {
  createElement(tag: 'script'): ScriptLike;
  readonly head: AppendTarget | null;
  readonly documentElement: AppendTarget | null;
}
/** Minimal structural shape of the iframe element. */
interface IframeLike {
  readonly contentDocument: DocumentLike | null;
}

export type InjectionResult =
  | { ok: true }
  | { ok: false; reason: 'no-document' | 'cross-origin' | 'append-failed'; message: string };

/**
 * Inject `OVERLAY_SCRIPT` into the iframe's document. Safe to call multiple
 * times; the helper marks the document so repeat calls during a single load
 * are no-ops. Callers should still call this on every iframe `load` event
 * because a navigation creates a fresh document.
 */
export function injectOverlayBridge(iframe: IframeLike): InjectionResult {
  let doc: DocumentLike | null;
  try {
    doc = iframe.contentDocument;
  } catch (err) {
    return {
      ok: false,
      reason: 'cross-origin',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (doc === null) {
    return { ok: false, reason: 'no-document', message: 'iframe.contentDocument is null' };
  }
  const docKey = doc as unknown as object;
  if (injectedDocuments.has(docKey)) {
    return { ok: true };
  }
  try {
    const script = doc.createElement('script');
    script.textContent = OVERLAY_SCRIPT;
    const target: AppendTarget | null = doc.head ?? doc.documentElement;
    if (target === null) {
      return { ok: false, reason: 'no-document', message: 'document has no head/root' };
    }
    target.appendChild(script);
    injectedDocuments.add(docKey);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'append-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
