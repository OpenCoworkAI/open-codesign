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
 * idempotent because we tag the document with `__codesignOverlayInstalled`
 * per listener.
 *
 * Bundled as a string at build time; do NOT import from anywhere except
 * the runtime's iframe HTML builder.
 */

export const OVERLAY_SCRIPT = `(function() {
  'use strict';
  var hovered = null;

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
    if (hovered) hovered.style.outline = '';
    hovered = e.target;
    if (hovered) hovered.style.outline = '2px solid #c96442';
  }
  function onMouseOut() {
    if (hovered) hovered.style.outline = '';
    hovered = null;
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var rect = el.getBoundingClientRect();
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'ELEMENT_SELECTED',
        selector: getXPath(el),
        tag: el.tagName.toLowerCase(),
        outerHTML: (el.outerHTML || '').slice(0, 800),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      }, '*');
    } catch (_) {}
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
    } catch (_) {}
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
    } catch (_) {}
  }

  // Install + reinstall every 200ms. User code may call removeEventListener
  // or replace document.addEventListener; re-attaching is the cheapest defence.
  // Each listener carries a unique flag so we don't double-install.
  var installs = [
    { evt: 'mouseover', fn: onMouseOver, flag: '__cs_mover' },
    { evt: 'mouseout', fn: onMouseOut, flag: '__cs_mout' },
    { evt: 'click', fn: onClick, flag: '__cs_click' }
  ];
  function reattach() {
    for (var i = 0; i < installs.length; i++) {
      var spec = installs[i];
      // Always remove + add — addEventListener with the same fn+capture is a
      // no-op when already attached; remove is also a no-op when missing.
      try { document.removeEventListener(spec.evt, spec.fn, true); } catch (_) {}
      try { document.addEventListener(spec.evt, spec.fn, true); } catch (_) {}
    }
    if (!window.__cs_err) {
      try { window.addEventListener('error', onError, true); window.__cs_err = true; } catch (_) {}
    }
    if (!window.__cs_rej) {
      try { window.addEventListener('unhandledrejection', onRejection, true); window.__cs_rej = true; } catch (_) {}
    }
  }
  reattach();
  try { setInterval(reattach, 200); } catch (_) {}
})();`;

export interface OverlayMessage {
  __codesign: true;
  type: 'ELEMENT_SELECTED';
  selector: string;
  tag: string;
  outerHTML: string;
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
