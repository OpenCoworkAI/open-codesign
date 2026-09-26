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

import { bindSourceEditFields } from './source-edit-binding';
import {
  isSourceEditRevision,
  isSourceEditSelection,
  SOURCE_EDIT_ATTRIBUTE,
  type SourceEditAncestor,
  type SourceEditOverlayContext,
  type SourceEditSelection,
} from './source-edit-instrumentation';

export function buildOverlayScript(sourceEdit?: SourceEditOverlayContext): string {
  return `(function() {
  'use strict';
  var hovered = null;
  var pinned = null;
  var originalOutlines = new WeakMap();
  var warned = Object.create(null);
  function warnOnce(key, err) {
    if (warned[key]) return;
    warned[key] = true;
    try { console.warn('[overlay] ' + key, err); } catch (_) { /* noop */ }
  }
  var currentMode = 'default';
  var sourceEditContext = ${JSON.stringify(sourceEdit ?? null).replaceAll('<', '\\u003c')};
  var bindFields = ${sourceEdit?.fieldPlans ? bindSourceEditFields.toString() : 'null'};
  var editHitLayer = null;
  var pinnedSourceEditSignature = '';
  var fieldBindings = new WeakMap();
  var invalidTextFields = new WeakMap();
  var textObserver = null;
  var mutationOverflow = false;
  function markedFieldPlan(el) {
    if (!sourceEditContext || !sourceEditContext.fieldPlans || !el || !el.getAttribute) return null;
    var marker = el.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
    var prefix = sourceEditContext.previewRevision + ':';
    return marker && marker.indexOf(prefix) === 0 ? sourceEditContext.fieldPlans[marker.slice(prefix.length)] : null;
  }
  function rememberBindings(el, plan) {
    if (fieldBindings.has(el) || !plan || !bindFields) return;
    var bindings = new Map();
    bindFields(el, plan, sourceEditContext.previewRevision, function(key, node) { bindings.set(key, node); });
    fieldBindings.set(el, bindings);
  }
  function invalidateRemovedText(host, node, oldValue) {
    var plan = markedFieldPlan(host);
    if (!plan) return;
    var bindings = fieldBindings.get(host);
    var invalid = invalidTextFields.get(host) || new Set();
    for (var i = 0; i < plan.textLayout.length; i++) {
      var part = plan.textLayout[i];
      if (part.kind !== 'text') continue;
      var key = 'text:' + (part.textId || 'only');
      if (bindings && bindings.has(key) ? bindings.get(key) === node : part.value === oldValue) invalid.add(key);
    }
    invalidTextFields.set(host, invalid);
  }
  function processTextMutations(records) {
    if (records.length > 4096) { mutationOverflow = true; return; }
    var oldParents = new WeakMap();
    var scanRoots = [];
    var touched = new Set();
    var work = 0;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === 'childList') {
        touched.add(record.target);
        for (var j = 0; j < record.removedNodes.length; j++) {
          if (++work > 10000) { mutationOverflow = true; return; }
          var removed = record.removedNodes[j];
          if (removed.nodeType === 3) {
            var owners = oldParents.get(removed) || new Set();
            owners.add(record.target);
            oldParents.set(removed, owners);
            invalidateRemovedText(record.target, removed, removed.textContent);
          }
        }
        for (var j = 0; j < record.addedNodes.length; j++) {
          if (++work > 10000) { mutationOverflow = true; return; }
          if (record.addedNodes[j].nodeType === 1) scanRoots.push(record.addedNodes[j]);
        }
      }
    }
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === 'characterData') {
        var owners = oldParents.get(record.target) || new Set();
        if (record.target.parentElement) owners.add(record.target.parentElement);
        var ownerList = Array.from(owners);
        for (var j = 0; j < ownerList.length; j++) {
          if (++work > 10000) { mutationOverflow = true; return; }
          touched.add(ownerList[j]);
          invalidateRemovedText(ownerList[j], record.target, record.oldValue);
        }
      }
    }
    touched.forEach(function(el) { rememberBindings(el, markedFieldPlan(el)); });
    for (var i = 0; i < scanRoots.length; i++) {
      var stack = [scanRoots[i]];
      while (stack.length) {
        if (++work > 10000) { mutationOverflow = true; return; }
        var el = stack.pop();
        rememberBindings(el, markedFieldPlan(el));
        for (var child = el.firstElementChild; child; child = child.nextElementSibling) stack.push(child);
      }
    }
  }
  function flushTextMutations() {
    if (textObserver) processTextMutations(textObserver.takeRecords());
  }
  function sourceEditSelection(el) {
    flushTextMutations();
    if (!sourceEditContext || !el || typeof el.getAttribute !== 'function') return null;
    var marker = el.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
    var prefix = sourceEditContext.previewRevision + ':';
    if (typeof marker !== 'string' || marker.slice(0, prefix.length) !== prefix) return null;
    var id = marker.slice(prefix.length);
    if (!Object.prototype.hasOwnProperty.call(sourceEditContext.targets, id)) return null;
    if (String(el.tagName).toLowerCase() !== sourceEditContext.targets[id].toLowerCase()) return null;
    var fieldPlan = sourceEditContext.fieldPlans && sourceEditContext.fieldPlans[id];
    if (!fieldPlan && sourceEditContext.directTexts && Object.prototype.hasOwnProperty.call(sourceEditContext.directTexts, id)) {
      var directText = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) directText += el.childNodes[i].textContent;
      }
      if (directText !== sourceEditContext.directTexts[id]) return null;
    }
    // Authored code can forge same-frame DOM and messages; main must revalidate the source.
    var selection = { targetId: id, sourceHash: sourceEditContext.sourceHash, previewRevision: sourceEditContext.previewRevision };
    if (fieldPlan && bindFields) {
      rememberBindings(el, fieldPlan);
      var remembered = fieldBindings.get(el);
      selection.fieldStates = bindFields(el, fieldPlan, sourceEditContext.previewRevision, function(key, node) {
        if (remembered && remembered.has(key) && remembered.get(key) !== node) {
          var invalid = invalidTextFields.get(el) || new Set();
          invalid.add(key);
          invalidTextFields.set(el, invalid);
        }
      });
      var invalid = invalidTextFields.get(el);
      selection.fieldStates.forEach(function(field) {
        if (field.key.indexOf('text:') === 0 && (mutationOverflow || (invalid && invalid.has(field.key)))) {
          field.status = mutationOverflow ? 'unmapped' : 'changed';
          field.message = 'The original preview text node changed or was removed; reload before editing this field.';
        }
      });
    }
    return selection;
  }

  window.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    // Defer until artifact dialogs and other window listeners can consume Escape.
    queueMicrotask(function() {
      if (e.defaultPrevented || e.cancelBubble) return;
      try {
        window.parent.postMessage({ __codesign: true, type: 'PREVIEW_ESCAPE' }, '*');
      } catch (err) { warnOnce('postMessage PREVIEW_ESCAPE failed', err); }
    });
  });

  var watchedSelectors = [];
  var rectsFrameHandle = 0;

  function resolveBodyRelativePath(sel) {
    var parts = String(sel || '').slice(1).split('/');
    var current = document.body;
    if (sel === '/') return current;
    if (!current || !parts.length) return null;
    for (var i = 0; i < parts.length; i++) {
      var match = /^([a-zA-Z][a-zA-Z0-9-]*)\\[(\\d+)\\]$/.exec(parts[i]);
      if (!match) return null;
      var tag = String(match[1]).toUpperCase();
      var targetIndex = Number(match[2]);
      if (!targetIndex || !current.children) return null;
      var seen = 0;
      var next = null;
      for (var j = 0; j < current.children.length; j++) {
        var child = current.children[j];
        if (child && String(child.tagName).toUpperCase() === tag) {
          seen++;
          if (seen === targetIndex) {
            next = child;
            break;
          }
        }
      }
      if (!next) return null;
      current = next;
    }
    return current;
  }

  function resolveSelector(sel) {
    if (!sel || typeof sel !== 'string') return null;
    if (sel === '/') return document.body;
    try {
      var c = sel.charAt(0);
      if (c === '#' || c === '[' || c === '.') return document.querySelector(sel);
      if (c === '/') {
        var res = document.evaluate(sel, document, null, 9, null);
        if (res && res.singleNodeValue) return res.singleNodeValue;
        return resolveBodyRelativePath(sel);
      }
      return document.querySelector(sel);
    } catch (_) { return null; }
  }

  function measureAndPostRects() {
    rectsFrameHandle = 0;
    if (pinned && (pinned.isConnected === false || (pinned.getClientRects && !pinned.getClientRects().length))) {
      clearHover();
      clearPinned();
      try {
        window.parent.postMessage({ __codesign: true, type: 'ELEMENT_SELECTION_CLEARED' }, '*');
      } catch (err) { warnOnce('postMessage ELEMENT_SELECTION_CLEARED failed', err); }
    }
    if (!watchedSelectors.length) return;
    var entries = [];
    for (var i = 0; i < watchedSelectors.length; i++) {
      var sel = watchedSelectors[i];
      var el = resolveSelector(sel);
      if (!el || !el.getBoundingClientRect) continue;
      if (el.getClientRects && !el.getClientRects().length) continue;
      var r = el.getBoundingClientRect();
      entries.push({
        selector: sel,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height }
      });
    }
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'ELEMENT_RECTS',
        entries: entries
      }, '*');
    } catch (err) { warnOnce('postMessage ELEMENT_RECTS failed', err); }
  }

  function scheduleRectsBroadcast() {
    if (!pinned && !watchedSelectors.length) return;
    if (rectsFrameHandle) return;
    try {
      rectsFrameHandle = window.requestAnimationFrame(measureAndPostRects);
    } catch (_) {
      measureAndPostRects();
    }
  }

  var HOVER_OUTLINE = '2px solid #c96442';
  var PINNED_OUTLINE = '2.5px solid #b5441a';

  function setOutline(el, value) {
    if (!el || !el.style) return;
    if (!originalOutlines.has(el)) originalOutlines.set(el, el.style.outline || '');
    el.style.outline = value;
  }
  function restoreOutline(el) {
    if (!el || !el.style || !originalOutlines.has(el)) return;
    el.style.outline = originalOutlines.get(el);
    originalOutlines.delete(el);
    if (el.getAttribute && el.getAttribute('style') === '') el.removeAttribute('style');
  }

  function clearHover() {
    // Don't clear if this element is pinned — pinned takes precedence.
    if (hovered && hovered !== pinned) {
      try { restoreOutline(hovered); } catch (_) {}
    }
    hovered = null;
  }

  function clearPinned() {
    if (pinned) {
      try { restoreOutline(pinned); } catch (_) {}
    }
    pinned = null;
  }

  function pinElement(el, selector, scroll) {
    if (!el || !el.style) return;
    var alreadyPinned = pinned === el;
    if (pinned && pinned !== el) {
      try { restoreOutline(pinned); } catch (_) {}
    }
    pinned = el;
    try { setOutline(el, PINNED_OUTLINE); } catch (_) {}
    if (selector && watchedSelectors.indexOf(selector) === -1) watchedSelectors.push(selector);
    try {
      if (scroll !== false && !alreadyPinned && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch (_) { /* noop */ }
    scheduleRectsBroadcast();
  }


  function getXPath(el) {
    var candidates = [];
    if (window.CSS && window.CSS.escape) {
      if (el.dataset && el.dataset.codesignId) candidates.push('[data-codesign-id="' + window.CSS.escape(el.dataset.codesignId) + '"]');
      if (el.id) candidates.push('#' + window.CSS.escape(el.id));
    }
    for (var c = 0; c < candidates.length; c++) {
      var matches = document.querySelectorAll(candidates[c]);
      if (matches.length === 1 && matches[0] === el) return candidates[c];
    }
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

  function sourceAncestors(el) {
    var result = [];
    var parent = el && el.parentElement;
    while (parent && parent !== document.body && result.length < 16) {
      var marker = parent.getAttribute && parent.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
      var prefix = sourceEditContext && sourceEditContext.previewRevision + ':';
      if (marker && prefix && marker.indexOf(prefix) === 0 && Object.prototype.hasOwnProperty.call(sourceEditContext.targets, marker.slice(prefix.length))) {
        result.push({ selector: getXPath(parent), tagName: String(parent.tagName).toLowerCase() });
      }
      parent = parent.parentElement;
    }
    return result;
  }
  function emitSourceSelection(el) {
    if (!el || !el.getBoundingClientRect) return;
    var rect = el.getBoundingClientRect();
    var selector = getXPath(el);
    clearHover();
    pinElement(el, selector, false);
    var provenance = sourceEditSelection(el);
    pinnedSourceEditSignature = JSON.stringify(provenance);
    var selection = {
      __codesign: true, type: 'ELEMENT_SELECTED', selector: selector,
      tag: String(el.tagName).toLowerCase(), outerHTML: String(el.outerHTML || '').slice(0, 800),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      sourceEditAncestors: sourceAncestors(el),
      sourceEditRevision: { sourceHash: sourceEditContext.sourceHash, previewRevision: sourceEditContext.previewRevision }
    };
    if (provenance) selection.sourceEdit = provenance;
    window.parent.postMessage(selection, '*');
  }
  function elementUnderEditLayer(x, y) {
    if (!editHitLayer) return document.elementFromPoint(x, y);
    editHitLayer.style.pointerEvents = 'none';
    try { return document.elementFromPoint(x, y); }
    finally { editHitLayer.style.pointerEvents = 'auto'; }
  }
  function syncEditHitLayer() {
    if (currentMode !== 'source-edit') {
      if (editHitLayer) editHitLayer.remove();
      editHitLayer = null;
      return;
    }
    if (!editHitLayer) {
      editHitLayer = document.createElement('div');
      editHitLayer.setAttribute('data-codesign-edit-hit-layer', '');
      editHitLayer.setAttribute('aria-hidden', 'true');
      editHitLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:crosshair;touch-action:none';
      editHitLayer.addEventListener('wheel', function(e) {
        if (e.ctrlKey) return;
        var el = elementUnderEditLayer(e.clientX, e.clientY);
        while (el) {
          if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
            var style = window.getComputedStyle(el);
            if (/(auto|scroll)/.test(style.overflowY + style.overflowX) || el === document.scrollingElement) {
              var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
              el.scrollBy(e.deltaX * unit, e.deltaY * unit);
              e.preventDefault();
              return;
            }
          }
          el = el.parentElement;
        }
      }, { passive: false });
    }
    if (!editHitLayer.isConnected && document.documentElement) document.documentElement.appendChild(editHitLayer);
  }
  function onEditPointer(e) {
    if (currentMode !== 'source-edit') return;
    var el = elementUnderEditLayer(e.clientX, e.clientY);
    if (e.type === 'pointerdown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (el) emitSourceSelection(el);
    } else {
      if (hovered !== el) clearHover();
      hovered = el;
      if (hovered && hovered !== pinned) setOutline(hovered, HOVER_OUTLINE);
    }
  }
  function onMouseOver(e) {
    if (currentMode !== 'comment') return;
    // Don't override pinned outline on hover-in of a different element.
    if (hovered && hovered !== pinned) {
      try { restoreOutline(hovered); } catch (_) {}
    }
    hovered = e.target;
    if (hovered && hovered !== pinned) {
      try { setOutline(hovered, HOVER_OUTLINE); } catch (_) {}
    }
  }
  function onMouseOut() {
    if (currentMode !== 'comment') return;
    clearHover();
  }
  function onClick(e) {
    if (currentMode === 'source-edit') {
      e.preventDefault();
      e.stopImmediatePropagation();
      var hit = e.target === editHitLayer ? elementUnderEditLayer(e.clientX, e.clientY) : e.target;
      if (hit && hit !== pinned) emitSourceSelection(hit);
      return;
    }
    if (currentMode === 'comment') {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      // Pin the clicked element — its outline will persist until parent
      // sends CLEAR_PIN (bubble closed).
      var rect = el.getBoundingClientRect();
      var selector = getXPath(el);
      // Auto-watch the freshly-pinned element so scroll/resize immediately
      // keep its rect live, without waiting for a parent→iframe round-trip.
      clearHover();
      clearPinned();
      var selectedHtml = (el.outerHTML || '').slice(0, 800);
      var parentHtml = '';
      try {
        if (el.parentElement && el.parentElement.outerHTML) {
          parentHtml = String(el.parentElement.outerHTML).slice(0, 600);
        }
      } catch (_) { /* parent inaccessible — leave blank */ }
      pinElement(el, selector, false);
      try {
        var selection = {
          __codesign: true,
          type: 'ELEMENT_SELECTED',
          selector: selector,
          tag: el.tagName.toLowerCase(),
          outerHTML: selectedHtml,
          parentOuterHTML: parentHtml,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        };
        var provenance = sourceEditSelection(el);
        if (provenance) selection.sourceEdit = provenance;
        window.parent.postMessage(selection, '*');
      } catch (err) { console.warn('[overlay] postMessage ELEMENT_SELECTED failed:', err); }
      return;
    }
    // Default mode: block ALL navigating links — the sandbox iframe has no
    // routing and any real navigation (including hash jumps to non-existent
    // ids) would blank the preview. Agent should use React view-state for
    // multi-page designs; see agent.ts AGENTIC_TOOL_GUIDANCE.
    var anchor = e.target;
    while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
    if (anchor && (anchor.href || anchor.getAttribute('href'))) {
      var href = anchor.getAttribute('href') || '';
      // Allow hash-jump ONLY when it resolves to an existing element on page.
      if (href.charAt(0) === '#' && href.length > 1) {
        var id = href.slice(1);
        try { id = decodeURIComponent(id); } catch (_) {}
        var target = null;
        try { target = document.getElementById(id); } catch (_) {}
        if (target) {
          // A workspace base URL turns even #fragment links into document navigation.
          e.preventDefault();
          target.scrollIntoView();
          return;
        }
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
      var next = data.mode === 'source-edit' && sourceEditContext ? 'source-edit' : data.mode === 'comment' ? 'comment' : 'default';
      if (next === currentMode) return;
      currentMode = next;
      clearHover();
      clearPinned();
      syncEditHitLayer();
      return;
    }
    if (data.type === 'SOURCE_EDIT_SELECT' || data.type === 'SOURCE_EDIT_VALIDATE') {
      if (currentMode !== 'source-edit' || !sourceEditContext || data.sourceHash !== sourceEditContext.sourceHash || data.previewRevision !== sourceEditContext.previewRevision) return;
      if (data.type === 'SOURCE_EDIT_SELECT') {
        if (typeof data.selector !== 'string' || data.selector.length > 4000 || !pinned) return;
        var ancestors = sourceAncestors(pinned);
        if (!ancestors.some(function(item) { return item.selector === data.selector; })) return;
        var ancestor = resolveSelector(data.selector);
        if (ancestor) emitSourceSelection(ancestor);
      } else if (typeof data.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.requestId) && typeof data.fieldKey === 'string' && data.fieldKey.length < 100) {
        var validated = pinned && pinned.isConnected ? sourceEditSelection(pinned) : null;
        if (!validated || validated.targetId !== data.targetId) validated = null;
        window.parent.postMessage({ __codesign: true, type: 'SOURCE_EDIT_VALIDATED', requestId: data.requestId, sourceEdit: validated }, '*');
      }
      return;
    }
    if (data.type === 'CLEAR_PIN') {
      clearPinned();
      return;
    }
    if (data.type === 'PIN_SELECTOR') {
      var targetSelector = typeof data.selector === 'string' ? data.selector : '';
      var target = resolveSelector(targetSelector);
      if (target) pinElement(target, targetSelector);
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
    { evt: 'submit', fn: function(e) { e.preventDefault(); } }
  ];
  if (sourceEditContext) installs.push({ evt: 'pointerdown', fn: onEditPointer }, { evt: 'pointermove', fn: onEditPointer });
  function reattach() {
    if (currentMode === 'source-edit') {
      syncEditHitLayer();
      if (pinned && pinned.isConnected) {
        var signature = JSON.stringify(sourceEditSelection(pinned));
        if (signature !== pinnedSourceEditSignature) emitSourceSelection(pinned);
      }
    }
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
  if (sourceEditContext && bindFields && window.MutationObserver && document.documentElement) {
    textObserver = new window.MutationObserver(processTextMutations);
    textObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
    processTextMutations([{ type: 'childList', target: document.documentElement, removedNodes: [], addedNodes: [document.documentElement] }]);
  }
  reattach();
  if (window.MutationObserver && document.body) {
    var observer = new window.MutationObserver(scheduleRectsBroadcast);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  }
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
  try {
    if (!window.__cs_navguard) {
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
})();`;
}

export const OVERLAY_SCRIPT = buildOverlayScript();

export interface OverlayMessage {
  __codesign: true;
  type: 'ELEMENT_SELECTED';
  sourceEdit?: SourceEditSelection;
  sourceEditAncestors?: SourceEditAncestor[];
  sourceEditRevision?: Pick<SourceEditSelection, 'sourceHash' | 'previewRevision'>;
  selector: string;
  tag: string;
  outerHTML: string;
  /** Optional v2 enrichment — parent element's outerHTML, truncated to 600
   *  chars. Older overlays may omit this; consumers must treat it as optional. */
  parentOuterHTML?: string;
  rect: { top: number; left: number; width: number; height: number };
}

export function isOverlayMessage(data: unknown): data is OverlayMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Partial<OverlayMessage>;
  return (
    d.__codesign === true &&
    d.type === 'ELEMENT_SELECTED' &&
    (d.sourceEdit === undefined || isSourceEditSelection(d.sourceEdit)) &&
    (d.sourceEditRevision === undefined || isSourceEditRevision(d.sourceEditRevision)) &&
    (d.sourceEditAncestors === undefined ||
      (Array.isArray(d.sourceEditAncestors) &&
        d.sourceEditAncestors.length <= 16 &&
        d.sourceEditAncestors.every(
          (ancestor) =>
            ancestor &&
            typeof ancestor.selector === 'string' &&
            ancestor.selector.length > 0 &&
            ancestor.selector.length <= 4000 &&
            typeof ancestor.tagName === 'string' &&
            /^[a-z][A-Za-z0-9-]{0,127}$/.test(ancestor.tagName) &&
            Object.keys(ancestor).every((key) => ['selector', 'tagName'].includes(key)),
        ))) &&
    typeof d.selector === 'string' &&
    d.selector.length > 0 &&
    d.selector.length <= 8192 &&
    typeof d.tag === 'string' &&
    d.tag.length > 0 &&
    d.tag.length <= 128 &&
    typeof d.outerHTML === 'string' &&
    d.outerHTML.length <= 800 &&
    (d.parentOuterHTML === undefined ||
      (typeof d.parentOuterHTML === 'string' && d.parentOuterHTML.length <= 600)) &&
    isElementRect(d.rect)
  );
}

function isElementRect(rect: unknown): rect is OverlayMessage['rect'] {
  if (typeof rect !== 'object' || rect === null) return false;
  const r = rect as Partial<OverlayMessage['rect']>;
  return (
    typeof r.top === 'number' &&
    Number.isFinite(r.top) &&
    typeof r.left === 'number' &&
    Number.isFinite(r.left) &&
    typeof r.width === 'number' &&
    Number.isFinite(r.width) &&
    r.width >= 0 &&
    typeof r.height === 'number' &&
    Number.isFinite(r.height) &&
    r.height >= 0
  );
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
    if (!isElementRect(entry.rect)) return false;
  }
  return true;
}
