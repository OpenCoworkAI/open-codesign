/**
 * React inspector script — injected alongside `OVERLAY_SCRIPT` into the
 * engineering-mode iframe so the overlay's click handler can resolve the
 * clicked DOM node back to a React component (name, owner chain, and
 * `_debugSource` file location) without us having to ship react-devtools.
 *
 * Strategy:
 *  - Read the fiber off the DOM node via the `__reactFiber$<rendererId>`
 *    expando React DOM attaches (also accept the legacy
 *    `__reactInternalInstance$` shape for older Reacts).
 *  - Walk up via `fiber.return` until we hit a non-host fiber (one whose
 *    `type` is a function/class — host elements have string types like
 *    "div"). That's the closest user component.
 *  - Owner chain: walk `_debugOwner` (set in dev builds with the JSX
 *    runtime) up to a small depth.
 *  - `_debugSource` is dev-only; we don't synthesise one in prod.
 *
 * This script is a self-contained IIFE that publishes
 * `window.__codesignReactInspect(node)` returning the component metadata
 * or `null`. The overlay's click handler calls it; if it returns null the
 * overlay still posts the legacy `ELEMENT_SELECTED` so commenting / tweak
 * never silently breaks (R19 fallback).
 *
 * No `__REACT_DEVTOOLS_GLOBAL_HOOK__` dependency: the per-DOM-node fiber
 * expando is enough and works without us racing renderer registration.
 */

export const REACT_INSPECTOR_SCRIPT = `(function() {
  'use strict';
  // Idempotency guard — see overlay.ts.
  if (window.__cs_react_inspector_mounted) return;
  window.__cs_react_inspector_mounted = true;
  var OWNER_CHAIN_MAX = 6;

  function findFiberOnNode(node) {
    if (!node || typeof node !== 'object') return null;
    var keys;
    try { keys = Object.keys(node); } catch (_) { return null; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) {
        try { return node[k]; } catch (_) { return null; }
      }
    }
    return null;
  }

  function nameOfType(type) {
    if (!type) return null;
    if (typeof type === 'string') return null;
    try {
      if (type.displayName) return String(type.displayName);
      if (type.name) return String(type.name);
      if (type.render && (type.render.displayName || type.render.name)) {
        return String(type.render.displayName || type.render.name);
      }
      if (type.type && (type.type.displayName || type.type.name)) {
        return String(type.type.displayName || type.type.name);
      }
    } catch (_) { /* fallthrough */ }
    return null;
  }

  function findComponentFiber(start) {
    var f = start;
    while (f) {
      if (f.type && typeof f.type !== 'string') {
        var n = nameOfType(f.type);
        if (n) return { fiber: f, name: n };
      }
      f = f.return;
    }
    return null;
  }

  function buildOwnerChain(fiber) {
    var out = [];
    var owner = fiber && fiber._debugOwner ? fiber._debugOwner : null;
    var depth = 0;
    while (owner && depth < OWNER_CHAIN_MAX) {
      var n = nameOfType(owner.type);
      if (n) out.push(n);
      owner = owner._debugOwner;
      depth++;
    }
    return out;
  }

  function readDebugSource(fiber) {
    var src = fiber && fiber._debugSource;
    if (!src || typeof src.fileName !== 'string' || !src.fileName) return null;
    var out = { fileName: src.fileName };
    out.lineNumber = (typeof src.lineNumber === 'number' && src.lineNumber >= 0) ? src.lineNumber : 0;
    if (typeof src.columnNumber === 'number' && src.columnNumber >= 0) {
      out.columnNumber = src.columnNumber;
    }
    return out;
  }

  function inspect(node) {
    try {
      var startFiber = findFiberOnNode(node);
      if (!startFiber) return null;
      var hit = findComponentFiber(startFiber);
      if (!hit) return null;
      return {
        componentName: hit.name,
        ownerChain: buildOwnerChain(hit.fiber),
        debugSource: readDebugSource(hit.fiber)
      };
    } catch (_) {
      return null;
    }
  }

  try { window.__codesignReactInspect = inspect; } catch (_) { /* noop */ }
})();`;
