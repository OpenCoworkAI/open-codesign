/**
 * Overlay script injected into the sandbox iframe's srcdoc.
 *
 * Two responsibilities:
 *  1. Element selection (mouseover outline + click → ELEMENT_SELECTED postMessage).
 *  2. Error reporting (window.onerror + unhandledrejection → IFRAME_ERROR postMessage).
 *
 * Defence in depth (C11): generated HTML may attach its own click handlers,
 * call `removeEventListener`, or freeze prototypes. We use `capture: true` so
 * we run before bubble-phase user handlers, AND we re-attach the listeners
 * every 200ms via `setInterval` in case user code stripped them. Re-attach is
 * idempotent because addEventListener with the same fn+capture is a no-op
 * when already attached.
 *
 * Bundled as a string at build time; do NOT import from anywhere except
 * the runtime's iframe HTML builder.
 */

export const OVERLAY_SCRIPT = `(function() {
  'use strict';
  // Idempotency guard — the host (renderer or main-process webFrameMain)
  // may inject this script repeatedly across iframe reloads. Each new
  // document gets a fresh window, so the flag naturally resets per page.
  if (window.__cs_overlay_mounted) return;
  window.__cs_overlay_mounted = true;
  // URL-mode detection — hoisted so click guard, navguard, form guard, and
  // URL broadcaster all share the same check. Srcdoc iframes report
  // 'about:srcdoc' (protocol 'about:'); real dev servers report 'http(s):'.
  function isUrlMode() {
    try {
      var p = window.location && window.location.protocol;
      return p === 'http:' || p === 'https:';
    } catch (_) { return false; }
  }
  var hovered = null;
  var pinned = null;
  var warned = Object.create(null);
  function warnOnce(key, err) {
    if (warned[key]) return;
    warned[key] = true;
    try { console.warn('[overlay] ' + key, err); } catch (_) { /* noop */ }
  }
  var currentMode = 'default';

  var watchedSelectors = [];
  var rectsFrameHandle = 0;

  function resolveSelector(sel) {
    if (!sel || typeof sel !== 'string') return null;
    try {
      var c = sel.charAt(0);
      if (c === '#' || c === '[' || c === '.') return document.querySelector(sel);
      if (c === '/') {
        var res = document.evaluate(sel, document, null, 9, null);
        return res && res.singleNodeValue ? res.singleNodeValue : null;
      }
      return document.querySelector(sel);
    } catch (_) { return null; }
  }

  function measureAndPostRects() {
    rectsFrameHandle = 0;
    if (!watchedSelectors.length) return;
    var entries = [];
    for (var i = 0; i < watchedSelectors.length; i++) {
      var sel = watchedSelectors[i];
      var el = resolveSelector(sel);
      if (!el || !el.getBoundingClientRect) continue;
      var r = el.getBoundingClientRect();
      entries.push({
        selector: sel,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height }
      });
    }
    if (!entries.length) return;
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'ELEMENT_RECTS',
        entries: entries
      }, '*');
    } catch (err) { warnOnce('postMessage ELEMENT_RECTS failed', err); }
  }

  function scheduleRectsBroadcast() {
    if (rectsFrameHandle) return;
    try {
      rectsFrameHandle = window.requestAnimationFrame(measureAndPostRects);
    } catch (_) {
      measureAndPostRects();
    }
  }

  var HOVER_OUTLINE = '2px solid #c96442';
  var PINNED_OUTLINE = '2.5px solid #b5441a';

  function clearHover() {
    // Don't clear if this element is pinned — pinned takes precedence.
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = ''; } catch (_) {}
    }
    hovered = null;
  }

  function clearPinned() {
    if (pinned) {
      try { pinned.style.outline = ''; } catch (_) {}
    }
    pinned = null;
  }


  function getXPath(el) {
    if (el.dataset && el.dataset.codesignId) return '[data-codesign-id="' + el.dataset.codesignId + '"]';
    if (el.id) return '#' + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      var idx = 1;
      var sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(el.tagName.toLowerCase() + '[' + idx + ']');
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }

  function onMouseOver(e) {
    if (currentMode !== 'comment') return;
    // Don't override pinned outline on hover-in of a different element.
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = ''; } catch (_) {}
    }
    hovered = e.target;
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = HOVER_OUTLINE; } catch (_) {}
    }
  }
  function onMouseOut() {
    if (currentMode !== 'comment') return;
    clearHover();
  }
  function onClick(e) {
    if (currentMode === 'comment') {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      // Pin the clicked element — its outline will persist until parent
      // sends CLEAR_PIN (bubble closed).
      if (pinned && pinned !== el) {
        try { pinned.style.outline = ''; } catch (_) {}
      }
      pinned = el;
      try { el.style.outline = PINNED_OUTLINE; } catch (_) {}
      var rect = el.getBoundingClientRect();
      var selector = getXPath(el);
      // Auto-watch the freshly-pinned element so scroll/resize immediately
      // keep its rect live, without waiting for a parent→iframe round-trip.
      if (watchedSelectors.indexOf(selector) === -1) watchedSelectors.push(selector);
      var parentHtml = '';
      try {
        if (el.parentElement && el.parentElement.outerHTML) {
          parentHtml = String(el.parentElement.outerHTML).slice(0, 600);
        }
      } catch (_) { /* parent inaccessible — leave blank */ }
      try {
        window.parent.postMessage({
          __codesign: true,
          type: 'ELEMENT_SELECTED',
          selector: selector,
          tag: el.tagName.toLowerCase(),
          outerHTML: (el.outerHTML || '').slice(0, 800),
          parentOuterHTML: parentHtml,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        }, '*');
      } catch (err) { console.warn('[overlay] postMessage ELEMENT_SELECTED failed:', err); }
      // Engineering mode (U8): if the React inspector is available, follow up
      // with a COMPONENT_SELECTED carrying fiber-derived metadata. The desktop
      // store treats this as an enrichment of the just-posted ELEMENT_SELECTED
      // (matched by selector). Failure / no-fiber → silently degrade to the
      // plain ELEMENT_SELECTED already sent.
      try {
        var inspect = window.__codesignReactInspect;
        if (typeof inspect === 'function') {
          var meta = inspect(el);
          if (meta && meta.componentName) {
            window.parent.postMessage({
              __codesign: true,
              type: 'COMPONENT_SELECTED',
              selector: selector,
              componentName: String(meta.componentName),
              ownerChain: Array.isArray(meta.ownerChain) ? meta.ownerChain.slice(0, 6) : [],
              debugSource: meta.debugSource || null
            }, '*');
          }
        }
      } catch (err) { warnOnce('postMessage COMPONENT_SELECTED failed', err); }
      return;
    }
    // Default mode: block ALL navigating links — the sandbox iframe has no
    // routing and any real navigation (including hash jumps to non-existent
    // ids) would blank the preview. Agent should use React view-state for
    // multi-page designs; see agent.ts AGENTIC_TOOL_GUIDANCE.
    //
    // Engineering URL mode is the exception: the iframe loads a real dev
    // server (Next.js / Vite + React Router etc.) that owns its own
    // navigation. Detected via location.protocol — srcdoc iframes report
    // 'about:' (about:srcdoc), URL-mode iframes report 'http(s):'.
    if (isUrlMode()) return;
    var anchor = e.target;
    while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
    if (anchor && (anchor.href || anchor.getAttribute('href'))) {
      var href = anchor.getAttribute('href') || '';
      // Allow hash-jump ONLY when it resolves to an existing element on page.
      if (href.charAt(0) === '#' && href.length > 1) {
        var id = href.slice(1);
        var target = null;
        try { target = document.getElementById(id); } catch (_) {}
        if (target) return; // let the browser scroll
      }
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onParentMessage(ev) {
    // Trust boundary: control messages must originate from the embedding
    // window. Untrusted in-iframe scripts can synthesise MessageEvent-shaped
    // calls into this handler (or, via window.postMessage(self,...), bounce
    // events off the iframe itself); both paths are rejected here so any
    // future control type added to the switch is structurally protected.
    if (!ev || ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.__codesign !== true) return;
    if (data.type === 'SET_MODE') {
      var next = data.mode === 'comment' ? 'comment' : 'default';
      if (next === currentMode) return;
      currentMode = next;
      if (currentMode === 'default') {
        clearHover();
        clearPinned();
      }
      return;
    }
    if (data.type === 'CLEAR_PIN') {
      clearPinned();
      return;
    }
    if (data.type === 'WATCH_SELECTORS') {
      var list = data.selectors;
      if (!Array.isArray(list)) return;
      var dedup = [];
      var seen = Object.create(null);
      for (var i = 0; i < list.length; i++) {
        var sel = list[i];
        if (typeof sel !== 'string' || seen[sel]) continue;
        seen[sel] = true;
        dedup.push(sel);
      }
      watchedSelectors = dedup;
      scheduleRectsBroadcast();
      return;
    }
  }
  function onError(ev) {
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'IFRAME_ERROR',
        kind: 'error',
        message: (ev && ev.message) ? String(ev.message) : 'Unknown iframe error',
        source: ev && ev.filename ? String(ev.filename) : undefined,
        lineno: ev && typeof ev.lineno === 'number' ? ev.lineno : undefined,
        colno: ev && typeof ev.colno === 'number' ? ev.colno : undefined,
        stack: ev && ev.error && ev.error.stack ? String(ev.error.stack) : undefined,
        timestamp: Date.now()
      }, '*');
    } catch (err) { console.warn('[overlay] postMessage IFRAME_ERROR (error) failed:', err); }
  }
  function onRejection(ev) {
    try {
      var reason = ev && ev.reason;
      var msg = (reason && reason.message) ? String(reason.message) : String(reason);
      window.parent.postMessage({
        __codesign: true,
        type: 'IFRAME_ERROR',
        kind: 'unhandledrejection',
        message: msg,
        stack: (reason && reason.stack) ? String(reason.stack) : undefined,
        timestamp: Date.now()
      }, '*');
    } catch (err) { console.warn('[overlay] postMessage IFRAME_ERROR (unhandledrejection) failed:', err); }
  }

  // Install + reinstall every 200ms. User code may call removeEventListener
  // or replace document.addEventListener; re-attaching is the cheapest defence.
  // addEventListener with the same fn+capture is a no-op when already present.
  var installs = [
    { evt: 'mouseover', fn: onMouseOver },
    { evt: 'mouseout', fn: onMouseOut },
    { evt: 'click', fn: onClick },
    { evt: 'submit', fn: function(e) {
        // Same gate as onClick: real dev servers (URL mode) own their
        // own form handling. Only block submits in srcdoc preview.
        if (isUrlMode()) return;
        e.preventDefault();
      } }
  ];
  function reattach() {
    for (var i = 0; i < installs.length; i++) {
      var spec = installs[i];
      try { document.removeEventListener(spec.evt, spec.fn, true); } catch (err) { warnOnce('removeEventListener failed for ' + spec.evt, err); }
      try { document.addEventListener(spec.evt, spec.fn, true); } catch (err) { warnOnce('addEventListener failed for ' + spec.evt, err); }
    }
    if (!window.__cs_err) {
      try { window.addEventListener('error', onError, true); window.__cs_err = true; } catch (err) { warnOnce('attach window error listener failed', err); }
    }
    if (!window.__cs_rej) {
      try { window.addEventListener('unhandledrejection', onRejection, true); window.__cs_rej = true; } catch (err) { warnOnce('attach unhandledrejection listener failed', err); }
    }
    if (!window.__cs_msg) {
      try { window.addEventListener('message', onParentMessage, false); window.__cs_msg = true; } catch (_) {}
    }
    if (!window.__cs_scroll) {
      try {
        // capture=true so scrolls on inner overflow containers also bubble in here
        window.addEventListener('scroll', scheduleRectsBroadcast, true);
        window.addEventListener('resize', scheduleRectsBroadcast, false);
        window.__cs_scroll = true;
      } catch (err) { warnOnce('attach scroll/resize listener failed', err); }
    }
  }
  reattach();
  try {
    try { clearInterval(window.__cs_reattach_interval); } catch (_) {}
    window.__cs_reattach_interval = setInterval(reattach, 200);
    if (!window.__cs_reattach_unload) {
      window.__cs_reattach_unload = true;
      var stopReattach = function() {
        try { clearInterval(window.__cs_reattach_interval); } catch (_) {}
        window.__cs_reattach_interval = 0;
      };
      try { window.addEventListener('pagehide', stopReattach, false); } catch (_) {}
      try { window.addEventListener('beforeunload', stopReattach, false); } catch (_) {}
    }
  } catch (err) { try { console.warn('[overlay] setInterval reattach failed:', err); } catch (_) {} }

  // Neutralize programmatic navigation — generated code may call
  // window.location = '/foo', location.assign('/x'), or window.open(...)
  // in button onclick handlers. None of those routes exist in the sandbox and
  // they'd all blank the preview. We no-op them once, idempotently.
  // Skipped in URL mode — a real dev server / SPA router needs these.
  try {
    if (!window.__cs_navguard && !isUrlMode()) {
      window.__cs_navguard = true;
      var nopNav = function() { /* navigation suppressed in preview sandbox */ };
      try { window.open = function() { return null; }; } catch (_) {}
      try {
        var loc = window.location;
        try { loc.assign = nopNav; } catch (_) {}
        try { loc.replace = nopNav; } catch (_) {}
        try { loc.reload = nopNav; } catch (_) {}
      } catch (_) {}
    }
  } catch (err) { try { console.warn('[overlay] navguard install failed:', err); } catch (_) {} }

  // URL broadcaster — engineering URL-mode iframes are cross-origin from the
  // app shell, so the renderer can't read iframe.contentWindow.location.
  // Post the current path on mount and after any SPA navigation so the
  // renderer can scope visible comments / new-comment urlPath to the
  // current route. No-op in srcdoc mode.
  try {
    if (!window.__cs_urlbcast && isUrlMode()) {
      window.__cs_urlbcast = true;
      var postUrl = function() {
        try {
          window.parent.postMessage({
            __codesign: true,
            type: 'URL_CHANGED',
            path: location.pathname + location.search + location.hash,
            pathname: location.pathname,
            href: location.href
          }, '*');
        } catch (_) {}
      };
      // Initial broadcast — covers full page loads (incl. cross-document
      // SPA navigation that re-runs the overlay script).
      try { postUrl(); } catch (_) {}
      try { window.addEventListener('popstate', postUrl, false); } catch (_) {}
      try { window.addEventListener('hashchange', postUrl, false); } catch (_) {}
      try {
        var rawPush = history.pushState;
        var rawReplace = history.replaceState;
        history.pushState = function() {
          var r = rawPush.apply(this, arguments);
          try { postUrl(); } catch (_) {}
          return r;
        };
        history.replaceState = function() {
          var r = rawReplace.apply(this, arguments);
          try { postUrl(); } catch (_) {}
          return r;
        };
      } catch (_) {}
    }
  } catch (err) { try { console.warn('[overlay] url broadcaster install failed:', err); } catch (_) {} }
})();`;

export interface OverlayMessage {
  __codesign: true;
  type: 'ELEMENT_SELECTED';
  selector: string;
  tag: string;
  outerHTML: string;
  /** Optional v2 enrichment — parent element's outerHTML, truncated to 600
   *  chars. Older overlays may omit this; consumers must treat it as optional. */
  parentOuterHTML?: string;
  rect: { top: number; left: number; width: number; height: number };
}

export function isOverlayMessage(data: unknown): data is OverlayMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { __codesign?: boolean }).__codesign === true &&
    (data as { type?: string }).type === 'ELEMENT_SELECTED'
  );
}

/** URL_CHANGED — engineering URL-mode iframes broadcast their pathname on
 *  mount and after every SPA navigation (popstate / hashchange / patched
 *  history.{push,replace}State). The renderer uses this to scope visible
 *  comments and stamp `urlPath` on newly created comments. Cross-origin
 *  iframes block direct location reads, so the in-iframe overlay is the
 *  only signal source. */
export interface UrlChangedMessage {
  __codesign: true;
  type: 'URL_CHANGED';
  /** Full path including search + hash — preferred for stable identity. */
  path: string;
  /** Bare pathname — convenient for prefix matching. */
  pathname: string;
  href: string;
}

export function isUrlChangedMessage(data: unknown): data is UrlChangedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { __codesign?: boolean; type?: string; pathname?: unknown };
  return d.__codesign === true && d.type === 'URL_CHANGED' && typeof d.pathname === 'string';
}

export interface ElementRectsMessage {
  __codesign: true;
  type: 'ELEMENT_RECTS';
  entries: Array<{
    selector: string;
    rect: { top: number; left: number; width: number; height: number };
  }>;
}

/** Hard ceiling on entries per ELEMENT_RECTS message. The iframe runs LLM
 *  HTML; even though our overlay is trusted, untrusted in-iframe code can
 *  synthesise a matching envelope. Cap worst-case memory growth in the
 *  parent's liveRects store. Chosen generously — a design with 256 tracked
 *  pins is already beyond any realistic review session. */
export const MAX_ELEMENT_RECTS_ENTRIES = 256;

export function isElementRectsMessage(data: unknown): data is ElementRectsMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { __codesign?: boolean; type?: string; entries?: unknown };
  if (d.__codesign !== true || d.type !== 'ELEMENT_RECTS') return false;
  if (!Array.isArray(d.entries)) return false;
  if (d.entries.length > MAX_ELEMENT_RECTS_ENTRIES) return false;
  for (const e of d.entries) {
    if (typeof e !== 'object' || e === null) return false;
    const entry = e as { selector?: unknown; rect?: unknown };
    if (typeof entry.selector !== 'string') return false;
    const r = entry.rect as { top?: unknown; left?: unknown; width?: unknown; height?: unknown };
    if (
      typeof r !== 'object' ||
      r === null ||
      typeof r.top !== 'number' ||
      typeof r.left !== 'number' ||
      typeof r.width !== 'number' ||
      typeof r.height !== 'number'
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Engineering-mode enrichment for the previous `ELEMENT_SELECTED`. The
 * overlay posts this back-to-back with `ELEMENT_SELECTED` whenever the
 * injected React inspector resolves a fiber for the clicked node. Consumers
 * match on `selector` to attach the metadata to the same pending selection.
 */
export interface ComponentSelectedMessage {
  __codesign: true;
  type: 'COMPONENT_SELECTED';
  selector: string;
  componentName: string;
  ownerChain: string[];
  debugSource: {
    fileName: string;
    lineNumber: number;
    columnNumber?: number;
  } | null;
}

export function isComponentSelectedMessage(data: unknown): data is ComponentSelectedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as {
    __codesign?: boolean;
    type?: string;
    selector?: unknown;
    componentName?: unknown;
    ownerChain?: unknown;
    debugSource?: unknown;
  };
  if (d.__codesign !== true || d.type !== 'COMPONENT_SELECTED') return false;
  if (typeof d.selector !== 'string' || d.selector.length === 0) return false;
  if (typeof d.componentName !== 'string' || d.componentName.length === 0) return false;
  if (!Array.isArray(d.ownerChain)) return false;
  for (const owner of d.ownerChain) {
    if (typeof owner !== 'string') return false;
  }
  if (d.debugSource !== null) {
    if (typeof d.debugSource !== 'object' || d.debugSource === null) return false;
    const ds = d.debugSource as {
      fileName?: unknown;
      lineNumber?: unknown;
      columnNumber?: unknown;
    };
    if (typeof ds.fileName !== 'string' || ds.fileName.length === 0) return false;
    if (typeof ds.lineNumber !== 'number') return false;
    if (ds.columnNumber !== undefined && typeof ds.columnNumber !== 'number') return false;
  }
  return true;
}
