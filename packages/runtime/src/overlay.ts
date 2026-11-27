/**
 * Overlay script injected into the sandbox iframe's srcdoc.
 *
 * Two responsibilities:
 *  1. Element selection (mouseover outline / Shadow DOM HUD + click → ELEMENT_SELECTED postMessage).
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

import {
  SourceEditAttributeName,
  SourceEditElementSnapshot,
  SourceEditStyleProperty,
} from '@open-codesign/shared';
import { bindSourceEditFields } from './source-edit-binding';
import {
  isSourceEditRevision,
  isSourceEditSelection,
  SOURCE_EDIT_ATTRIBUTE,
  SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE,
  type SourceEditAncestor,
  type SourceEditOverlayContext,
  type SourceEditSelection,
} from './source-edit-instrumentation';

export const SOURCE_EDIT_HUD_ATTRIBUTE = 'data-codesign-hud';
export const SOURCE_EDIT_PREVIEW_STYLE_ID = 'codesign-edit-preview';

export type { SourceEditElementSnapshot };

export function isSourceEditElementSnapshot(value: unknown): value is SourceEditElementSnapshot {
  return SourceEditElementSnapshot.safeParse(value).success;
}

export function buildOverlayScript(sourceEdit?: SourceEditOverlayContext): string {
  const styleKeysJson = JSON.stringify(SourceEditStyleProperty.options);
  const attrKeysJson = JSON.stringify(SourceEditAttributeName.options);
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
  var bindFields = ${sourceEdit ? bindSourceEditFields.toString() : 'null'};
  var editHitLayer = null;
  var hudHost = null;
  var hudShadow = null;
  var hudLayer = null;
  var hudHighlightBoxModel = false;
  var previewStyleEl = null;
  var pinnedSourceEditSignature = '';
  var fieldBindings = new WeakMap();
  var invalidTextFields = new WeakMap();
  var textObserver = null;
  var mutationOverflow = false;
  var suppressTextObserver = false;
  var pinnedWatchedSelector = null;
  var pinnedResizeObserver = null;
  var screenStyle = null;

  var SNAPSHOT_STYLE_KEYS = ${styleKeysJson};
  var PREVIEW_STYLE_KEYS = SNAPSHOT_STYLE_KEYS;
  var UNITLESS_STYLE_KEYS = ['color', 'background', 'backgroundColor', 'borderColor', 'opacity', 'fontWeight', 'lineHeight'];
  var PREVIEW_ATTRIBUTE_KEYS = ${attrKeysJson};
  var TYPOGRAPHY_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'color'];

  function cssPropertyName(key) {
    return key.replace(/[A-Z]/g, function(letter) { return '-' + letter.toLowerCase(); });
  }
  function cssEscapeAttr(value) {
    return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  }
  function isOverlayNode(node) {
    var cur = node;
    while (cur) {
      if (cur === hudHost || cur === editHitLayer || cur === previewStyleEl || cur === screenStyle) return true;
      if (cur.nodeType === 1) {
        if (cur.id === '${SOURCE_EDIT_PREVIEW_STYLE_ID}') return true;
        if (cur.hasAttribute && (cur.hasAttribute('${SOURCE_EDIT_HUD_ATTRIBUTE}') || cur.hasAttribute('data-codesign-edit-hit-layer') || cur.hasAttribute('data-codesign-preview-style'))) return true;
      }
      cur = cur.parentNode || cur.parentElement;
    }
    return false;
  }
  function stripSyntheticAttrs(html) {
    return String(html || '')
      .replace(/\\s${SOURCE_EDIT_ATTRIBUTE}=(?:"[^"]*"|'[^']*'|[^\\s>]*)/g, '')
      .replace(/\\s${SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE}=(?:"[^"]*"|'[^']*'|[^\\s>]*)/g, '');
  }
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
    if (suppressTextObserver) return;
    var filtered = [];
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      if (!rec || isOverlayNode(rec.target)) continue;
      filtered.push(rec);
    }
    if (!filtered.length) return;
    if (filtered.length > 4096) { mutationOverflow = true; return; }
    var oldParents = new WeakMap();
    var scanRoots = [];
    var touched = new Set();
    var work = 0;
    for (var i = 0; i < filtered.length; i++) {
      var record = filtered[i];
      if (record.type === 'childList') {
        touched.add(record.target);
        for (var j = 0; j < record.removedNodes.length; j++) {
          var removed = record.removedNodes[j];
          if (isOverlayNode(removed)) continue;
          if (++work > 10000) { mutationOverflow = true; return; }
          if (removed.nodeType === 3) {
            var owners = oldParents.get(removed) || new Set();
            owners.add(record.target);
            oldParents.set(removed, owners);
            invalidateRemovedText(record.target, removed, removed.textContent);
          }
        }
        for (var j = 0; j < record.addedNodes.length; j++) {
          var added = record.addedNodes[j];
          if (isOverlayNode(added)) continue;
          if (++work > 10000) { mutationOverflow = true; return; }
          if (added.nodeType === 1) scanRoots.push(added);
        }
      }
    }
    for (var i = 0; i < filtered.length; i++) {
      var record = filtered[i];
      if (record.type === 'characterData') {
        if (isOverlayNode(record.target)) continue;
        var owners = oldParents.get(record.target) || new Set();
        if (record.target.parentElement) owners.add(record.target.parentElement);
        var ownerList = Array.from(owners);
        for (var j = 0; j < ownerList.length; j++) {
          if (isOverlayNode(ownerList[j])) continue;
          if (++work > 10000) { mutationOverflow = true; return; }
          touched.add(ownerList[j]);
          invalidateRemovedText(ownerList[j], record.target, record.oldValue);
        }
      }
    }
    touched.forEach(function(el) {
      if (!isOverlayNode(el)) rememberBindings(el, markedFieldPlan(el));
    });
    for (var i = 0; i < scanRoots.length; i++) {
      var stack = [scanRoots[i]];
      while (stack.length) {
        var el = stack.pop();
        if (!el || isOverlayNode(el)) continue;
        if (++work > 10000) { mutationOverflow = true; return; }
        rememberBindings(el, markedFieldPlan(el));
        for (var child = el.firstElementChild; child; child = child.nextElementSibling) {
          if (!isOverlayNode(child)) stack.push(child);
        }
      }
    }
  }
  function flushTextMutations() {
    if (textObserver) processTextMutations(textObserver.takeRecords());
  }

  function getPreviewStyleEl() {
    if (previewStyleEl && previewStyleEl.isConnected !== false) return previewStyleEl;
    if (document.getElementById) {
      var existing = document.getElementById('${SOURCE_EDIT_PREVIEW_STYLE_ID}');
      if (existing) { previewStyleEl = existing; return existing; }
    }
    if (!document.createElement) return null;
    var container = document.head || document.documentElement;
    if (!container || typeof container.appendChild !== 'function') return null;
    var el = document.createElement('style');
    if (!el || el === editHitLayer) return null;
    el.id = '${SOURCE_EDIT_PREVIEW_STYLE_ID}';
    if (typeof el.setAttribute === 'function') el.setAttribute('data-codesign-preview-style', '');
    container.appendChild(el);
    previewStyleEl = el;
    return el;
  }

  // Live inspector drafts use #codesign-edit-preview for styles and temporary
  // attributes/text overrides on the pinned host. They are reverted before every
  // provenance check, so validation always sees the bytes the source produced.
  var previewState = null;
  var pendingRestoreSelector = null;
  var pendingRestoreAttempts = 0;

  function revertPreview() {
    if (!previewState) return;
    var state = previewState;
    previewState = null;
    var el = state.el;
    try {
      if (previewStyleEl) previewStyleEl.textContent = '';
      if (state.texts && state.texts.length) {
        flushTextMutations();
        suppressTextObserver = true;
        try {
          for (var t = 0; t < state.texts.length; t++) {
            var entry = state.texts[t];
            if (entry && entry.node) entry.node.textContent = entry.original;
          }
          if (textObserver && typeof textObserver.takeRecords === 'function') textObserver.takeRecords();
        } finally {
          suppressTextObserver = false;
        }
      }
      for (var attr in state.attrs) {
        if (!Object.prototype.hasOwnProperty.call(state.attrs, attr)) continue;
        if (state.attrs[attr] === null) el.removeAttribute(attr);
        else el.setAttribute(attr, state.attrs[attr]);
      }
    } catch (err) { warnOnce('revert source edit preview failed', err); }
  }

  function findMapTextNode(el, key) {
    if (!sourceEditContext || !sourceEditContext.mapSources || !el || !el.childNodes) return null;
    var match = /^map-text:(\\d+):(.+)$/.exec(key);
    if (!match) return null;
    var itemIdx = parseInt(match[1], 10);
    var fieldKey = match[2];
    var marker = el.getAttribute && el.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
    var prefix = sourceEditContext.previewRevision + ':';
    if (!marker || marker.indexOf(prefix) !== 0) return null;
    var targetId = marker.slice(prefix.length);
    var mapSource = sourceEditContext.mapSources[targetId];
    if (!mapSource || !mapSource.fields) return null;
    var expected = null;
    for (var f = 0; f < mapSource.fields.length; f++) {
      if (mapSource.fields[f].key === fieldKey) {
        expected = mapSource.fields[f].values && mapSource.fields[f].values[itemIdx];
        break;
      }
    }
    if (typeof expected !== 'string') return null;
    var found = null;
    for (var c = 0; c < el.childNodes.length; c++) {
      var child = el.childNodes[c];
      if (child && child.nodeType === 3 && child.textContent === expected) {
        if (found) return null;
        found = child;
      }
    }
    return found;
  }

  function applyPreview(el, request) {
    revertPreview();
    if (!el) return;
    var state = { el: el, request: request, attrs: {}, texts: [] };
    try {
      var decls = [];
      var styles = request.styles || {};
      var removedList = Array.isArray(request.removedStyles) ? request.removedStyles : [];
      var removedMap = Object.create(null);
      for (var r = 0; r < removedList.length; r++) {
        var rKey = removedList[r];
        if (typeof rKey === 'string' && PREVIEW_STYLE_KEYS.indexOf(rKey) !== -1) {
          removedMap[rKey] = true;
        }
      }
      for (var i = 0; i < PREVIEW_STYLE_KEYS.length; i++) {
        var key = PREVIEW_STYLE_KEYS[i];
        var value = styles[key];
        if (typeof value === 'string' && value.length <= 1000) {
          if (/[;{}<>\\\\\\r\\n]|\\/\\*|\\*\\//.test(value)) continue;
          var trimmed = value.trim();
          if (!trimmed) continue;
          if (UNITLESS_STYLE_KEYS.indexOf(key) === -1 && /^(?:\\d+(?:\\.\\d+)?|\\.\\d+)$/.test(trimmed)) {
            trimmed += 'px';
          }
          decls.push(cssPropertyName(key) + ': ' + trimmed + ' !important;');
        } else if (removedMap[key]) {
          decls.push(cssPropertyName(key) + ': unset !important;');
        }
      }
      if (request.hidden === true) {
        decls.push('display: none !important;');
      } else if (request.hidden === false && el.hasAttribute && el.hasAttribute('hidden')) {
        state.attrs['hidden'] = el.getAttribute('hidden');
        el.removeAttribute('hidden');
      }
      var marker = el.getAttribute ? el.getAttribute('${SOURCE_EDIT_ATTRIBUTE}') : null;
      if (decls.length && marker) {
        var styleEl = getPreviewStyleEl();
        if (styleEl) {
          styleEl.textContent = '[' + '${SOURCE_EDIT_ATTRIBUTE}' + '="' + cssEscapeAttr(marker) + '"] { ' + decls.join(' ') + ' }';
        }
      } else if (previewStyleEl) {
        previewStyleEl.textContent = '';
      }

      var attributes = request.attributes || {};
      for (var j = 0; j < PREVIEW_ATTRIBUTE_KEYS.length; j++) {
        var attrName = PREVIEW_ATTRIBUTE_KEYS[j];
        if (!Object.prototype.hasOwnProperty.call(attributes, attrName)) continue;
        var attrValue = attributes[attrName];
        if (attrValue === null) {
          state.attrs[attrName] = el.getAttribute(attrName);
          el.removeAttribute(attrName);
        } else if (typeof attrValue === 'string' && attrValue.length <= 100000) {
          state.attrs[attrName] = el.getAttribute(attrName);
          el.setAttribute(attrName, attrValue);
        }
      }

      if (typeof request.className === 'string' && request.className.length <= 4000) {
        state.attrs['class'] = el.getAttribute('class');
        el.setAttribute('class', request.className);
      }

      var texts = request.texts;
      if (texts && typeof texts === 'object') {
        var textKeys = Object.keys(texts).slice(0, 64);
        if (textKeys.length) {
          var plan = markedFieldPlan(el);
          if (plan && bindFields) rememberBindings(el, plan);
          var bindings = fieldBindings.get(el);
          var invalid = invalidTextFields.get(el);
          flushTextMutations();
          suppressTextObserver = true;
          try {
            for (var k = 0; k < textKeys.length; k++) {
              var tKey = textKeys[k];
              var tVal = texts[tKey];
              if (typeof tVal !== 'string' || tVal.length > 100000) continue;
              if (invalid && invalid.has(tKey)) continue;
              var tNode = bindings && bindings.get(tKey);
              if (!tNode && tKey.indexOf('map-text:') === 0) tNode = findMapTextNode(el, tKey);
              if (!tNode || tNode.nodeType !== 3) continue;
              state.texts.push({ node: tNode, original: String(tNode.textContent || '') });
              tNode.textContent = tVal;
            }
            if (textObserver && typeof textObserver.takeRecords === 'function') textObserver.takeRecords();
          } finally {
            suppressTextObserver = false;
          }
        }
      }
    } catch (err) { warnOnce('apply source edit preview failed', err); }
    previewState = state;
  }

  function sourceEditSelection(el) {
    var held = previewState && previewState.el === el ? previewState.request : null;
    if (held) revertPreview();
    try { return sourceEditSelectionNow(el); }
    finally { if (held) applyPreview(el, held); }
  }
  function sourceEditSelectionNow(el) {
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

  function ensureHud() {
    if (currentMode !== 'source-edit') return null;
    if (hudHost && hudHost.isConnected !== false && hudLayer) return hudLayer;
    if (!document.createElement || !document.documentElement || typeof document.documentElement.appendChild !== 'function') return null;
    if (!hudHost) {
      var host = document.createElement('div');
      if (!host || host === editHitLayer || typeof host.attachShadow !== 'function') return null;
      host.setAttribute('${SOURCE_EDIT_HUD_ATTRIBUTE}', '');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
      try {
        var shadow = host.attachShadow({ mode: 'open' });
        var style = document.createElement('style');
        style.textContent =
          '.layer{position:fixed;inset:0;pointer-events:none;}' +
          '.box{position:fixed;box-sizing:border-box;pointer-events:none;margin:0;padding:0;}' +
          '.hover{border:2px solid #c96442;}' +
          '.pinned{border:2.5px solid #b5441a;}' +
          '.instance{border:1.5px dashed rgba(201,100,66,0.75);}' +
          '.pill{position:fixed;pointer-events:none;background:#b5441a;color:#ffffff;font:600 10px/1.2 system-ui,-apple-system,sans-serif;padding:2px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.25);z-index:2;}' +
          '.margin-band{position:fixed;box-sizing:border-box;pointer-events:none;background:transparent;border-style:solid;border-color:rgba(245,158,11,0.22);}' +
          '.padding-band{position:fixed;box-sizing:border-box;pointer-events:none;background:transparent;border-style:solid;border-color:rgba(16,185,129,0.24);}';
        var layer = document.createElement('div');
        layer.className = 'layer';
        shadow.appendChild(style);
        shadow.appendChild(layer);
        hudHost = host;
        hudShadow = shadow;
        hudLayer = layer;
      } catch (_) {
        return null;
      }
    }
    if (hudHost && hudHost.isConnected === false) {
      try { document.documentElement.appendChild(hudHost); } catch (_) { return null; }
    }
    return hudLayer;
  }

  function removeHud() {
    if (hudHost && typeof hudHost.remove === 'function') {
      try { hudHost.remove(); } catch (_) {}
    }
    hudHost = null;
    hudShadow = null;
    hudLayer = null;
  }

  function createHudBox(cls, rect) {
    var box = document.createElement('div');
    box.className = cls;
    box.style.top = rect.top + 'px';
    box.style.left = rect.left + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    return box;
  }

  function numCssSide(cs, prop) {
    if (!cs || typeof cs.getPropertyValue !== 'function') return 0;
    try {
      var n = parseFloat(cs.getPropertyValue(prop));
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (_) { return 0; }
  }

  function renderHud() {
    if (currentMode !== 'source-edit') {
      removeHud();
      return;
    }
    var layer = ensureHud();
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    if (hovered && hovered !== pinned && hovered.isConnected !== false && hovered.getBoundingClientRect) {
      try {
        var hr = hovered.getBoundingClientRect();
        if (hr && hr.width >= 0 && hr.height >= 0) {
          layer.appendChild(createHudBox('box hover', hr));
        }
      } catch (_) {}
    }

    if (pinned && pinned.isConnected !== false && pinned.getBoundingClientRect) {
      try {
        var pr = pinned.getBoundingClientRect();
        if (pr && pr.width >= 0 && pr.height >= 0) {
          if (hudHighlightBoxModel && typeof window.getComputedStyle === 'function') {
            try {
              var pcs = window.getComputedStyle(pinned);
              if (pcs) {
                var mt = numCssSide(pcs, 'margin-top');
                var mr = numCssSide(pcs, 'margin-right');
                var mb = numCssSide(pcs, 'margin-bottom');
                var ml = numCssSide(pcs, 'margin-left');
                if (mt > 0 || mr > 0 || mb > 0 || ml > 0) {
                  var mBox = document.createElement('div');
                  mBox.className = 'margin-band';
                  mBox.style.top = (pr.top - mt) + 'px';
                  mBox.style.left = (pr.left - ml) + 'px';
                  mBox.style.width = (pr.width + ml + mr) + 'px';
                  mBox.style.height = (pr.height + mt + mb) + 'px';
                  mBox.style.borderWidth = mt + 'px ' + mr + 'px ' + mb + 'px ' + ml + 'px';
                  layer.appendChild(mBox);
                }
                var pt = numCssSide(pcs, 'padding-top');
                var prPad = numCssSide(pcs, 'padding-right');
                var pb = numCssSide(pcs, 'padding-bottom');
                var pl = numCssSide(pcs, 'padding-left');
                var bt = numCssSide(pcs, 'border-top-width');
                var br = numCssSide(pcs, 'border-right-width');
                var bb = numCssSide(pcs, 'border-bottom-width');
                var bl = numCssSide(pcs, 'border-left-width');
                if (pt > 0 || prPad > 0 || pb > 0 || pl > 0) {
                  var pBox = document.createElement('div');
                  pBox.className = 'padding-band';
                  pBox.style.top = (pr.top + bt) + 'px';
                  pBox.style.left = (pr.left + bl) + 'px';
                  pBox.style.width = Math.max(0, pr.width - bl - br) + 'px';
                  pBox.style.height = Math.max(0, pr.height - bt - bb) + 'px';
                  pBox.style.borderWidth = pt + 'px ' + prPad + 'px ' + pb + 'px ' + pl + 'px';
                  layer.appendChild(pBox);
                }
              }
            } catch (_) {}
          }

          if (sourceEditContext && pinned.getAttribute && document.querySelectorAll) {
            var marker = pinned.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
            var prefix = sourceEditContext.previewRevision + ':';
            if (marker && marker.indexOf(prefix) === 0 && Object.prototype.hasOwnProperty.call(sourceEditContext.targets, marker.slice(prefix.length))) {
              try {
                var matches = document.querySelectorAll('[${SOURCE_EDIT_ATTRIBUTE}="' + cssEscapeAttr(marker) + '"]');
                if (matches && matches.length > 1) {
                  var limit = Math.min(matches.length, 200);
                  for (var m = 0; m < limit; m++) {
                    var inst = matches[m];
                    if (!inst || inst === pinned || inst.isConnected === false || !inst.getBoundingClientRect) continue;
                    if (inst.getClientRects && !inst.getClientRects().length) continue;
                    var ir = inst.getBoundingClientRect();
                    layer.appendChild(createHudBox('box instance', ir));
                  }
                }
              } catch (_) {}
            }
          }

          layer.appendChild(createHudBox('box pinned', pr));

          var pill = document.createElement('div');
          pill.className = 'pill';
          pill.textContent = String(pinned.tagName || '').toLowerCase() + ' \\u00b7 ' + Math.round(pr.width) + '\\u00d7' + Math.round(pr.height);
          pill.style.left = Math.max(0, pr.left) + 'px';
          pill.style.top = Math.max(0, pr.top - 20) + 'px';
          layer.appendChild(pill);
        }
      } catch (_) {}
    }
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
    if (currentMode === 'source-edit') renderHud();
    var selectorsToMeasure = watchedSelectors.slice();
    if (pinnedWatchedSelector && selectorsToMeasure.indexOf(pinnedWatchedSelector) === -1) {
      selectorsToMeasure.push(pinnedWatchedSelector);
    }
    if (!selectorsToMeasure.length) return;
    var entries = [];
    for (var i = 0; i < selectorsToMeasure.length; i++) {
      var sel = selectorsToMeasure[i];
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
    if (!pinned && !pinnedWatchedSelector && !watchedSelectors.length && !(currentMode === 'source-edit' && hovered)) return;
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
    if (currentMode === 'source-edit') renderHud();
  }

  function disconnectPinnedResizeObserver() {
    if (pinnedResizeObserver) {
      try { pinnedResizeObserver.disconnect(); } catch (_) {}
      pinnedResizeObserver = null;
    }
  }

  function clearPinned() {
    pendingRestoreSelector = null;
    pendingRestoreAttempts = 0;
    pinnedWatchedSelector = null;
    disconnectPinnedResizeObserver();
    revertPreview();
    if (pinned) {
      try { restoreOutline(pinned); } catch (_) {}
    }
    pinned = null;
    if (currentMode === 'source-edit') renderHud();
  }

  function pinElement(el, selector, scroll) {
    if (!el || (currentMode === 'comment' && !el.style)) return;
    var alreadyPinned = pinned === el;
    if (pinned && pinned !== el) {
      try { restoreOutline(pinned); } catch (_) {}
    }
    pinned = el;
    if (currentMode === 'comment') {
      try { setOutline(el, PINNED_OUTLINE); } catch (_) {}
    }
    pinnedWatchedSelector = selector || null;
    disconnectPinnedResizeObserver();
    if (typeof window.ResizeObserver === 'function') {
      try {
        pinnedResizeObserver = new window.ResizeObserver(function() {
          scheduleRectsBroadcast();
        });
        pinnedResizeObserver.observe(el);
      } catch (_) {
        pinnedResizeObserver = null;
      }
    }
    try {
      if (scroll !== false && !alreadyPinned && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch (_) { /* noop */ }
    if (currentMode === 'source-edit') renderHud();
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

  function selectionHtml(el) {
    var mapped = el.closest && el.closest('[data-design-system]');
    var key = mapped && mapped.getAttribute('data-design-system');
    var hint = key && /^[a-zA-Z0-9_.-]{1,160}$/.test(key) ? '<!-- DESIGN.md: ' + key + ' -->' : '';
    return hint + stripSyntheticAttrs(el.outerHTML).slice(0, 800 - hint.length);
  }

  function parentHtmlOf(el) {
    try {
      if (el && el.parentElement && el.parentElement.outerHTML) {
        return stripSyntheticAttrs(el.parentElement.outerHTML).slice(0, 600);
      }
    } catch (_) { /* parent inaccessible — leave blank */ }
    return '';
  }

  function sourceAncestors(el) {
    var result = [];
    var parent = el && el.parentElement;
    while (parent && parent !== document.body && result.length < 16) {
      if (isOverlayNode(parent)) {
        parent = parent.parentElement;
        continue;
      }
      var marker = parent.getAttribute && parent.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
      var prefix = sourceEditContext && sourceEditContext.previewRevision + ':';
      if (marker && prefix && marker.indexOf(prefix) === 0 && Object.prototype.hasOwnProperty.call(sourceEditContext.targets, marker.slice(prefix.length))) {
        result.push({ selector: getXPath(parent), tagName: String(parent.tagName).toLowerCase() });
      }
      parent = parent.parentElement;
    }
    return result;
  }

  function findItemIndex(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.getAttribute) {
        var raw = cur.getAttribute('${SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE}');
        if (typeof raw === 'string' && /^(?:0|[1-9]\\d{0,4})$/.test(raw)) {
          var parsed = parseInt(raw, 10);
          if (parsed >= 0 && parsed <= 10000) return parsed;
        }
      }
      cur = cur.parentElement;
    }
    return undefined;
  }

  function collectElementSnapshot(el, rect) {
    var computedStyle = {};
    var cs = null;
    try {
      if (typeof window.getComputedStyle === 'function') cs = window.getComputedStyle(el);
    } catch (_) { cs = null; }
    if (cs) {
      for (var s = 0; s < SNAPSHOT_STYLE_KEYS.length; s++) {
        var propKey = SNAPSHOT_STYLE_KEYS[s];
        var rawVal = '';
        try {
          rawVal = typeof cs.getPropertyValue === 'function' ? cs.getPropertyValue(cssPropertyName(propKey)) : cs[propKey];
        } catch (_) { rawVal = ''; }
        if (typeof rawVal === 'string') {
          var trimmedVal = rawVal.trim();
          if (trimmedVal.length > 0) computedStyle[propKey] = trimmedVal.slice(0, 1000);
        }
      }
    }
    var boxModel = {
      width: rect && typeof rect.width === 'number' && Number.isFinite(rect.width) && rect.width >= 0 ? rect.width : 0,
      height: rect && typeof rect.height === 'number' && Number.isFinite(rect.height) && rect.height >= 0 ? rect.height : 0,
      padding: {
        top: numCssSide(cs, 'padding-top'),
        right: numCssSide(cs, 'padding-right'),
        bottom: numCssSide(cs, 'padding-bottom'),
        left: numCssSide(cs, 'padding-left')
      },
      margin: {
        top: numCssSide(cs, 'margin-top'),
        right: numCssSide(cs, 'margin-right'),
        bottom: numCssSide(cs, 'margin-bottom'),
        left: numCssSide(cs, 'margin-left')
      },
      border: {
        top: numCssSide(cs, 'border-top-width'),
        right: numCssSide(cs, 'border-right-width'),
        bottom: numCssSide(cs, 'border-bottom-width'),
        left: numCssSide(cs, 'border-left-width')
      }
    };

    var marker = el.getAttribute ? el.getAttribute('${SOURCE_EDIT_ATTRIBUTE}') : null;
    var count = 1;
    if (marker && document.querySelectorAll) {
      try {
        var matches = document.querySelectorAll('[${SOURCE_EDIT_ATTRIBUTE}="' + cssEscapeAttr(marker) + '"]');
        if (matches && typeof matches.length === 'number') count = matches.length;
      } catch (_) {}
    }
    var snapshot = {
      computedStyle: computedStyle,
      boxModel: boxModel,
      instanceCount: Math.min(10000, Math.max(1, count || 1))
    };

    var itemIdx = findItemIndex(el);
    if (itemIdx !== undefined) snapshot.itemIndex = itemIdx;

    if (el.parentElement) {
      if (typeof window.getComputedStyle === 'function') {
        try {
          var pcs = window.getComputedStyle(el.parentElement);
          if (pcs) {
            var pDisplay = typeof pcs.getPropertyValue === 'function' ? pcs.getPropertyValue('display') : pcs.display;
            if (typeof pDisplay === 'string' && pDisplay) {
              var parentLayout = { display: pDisplay.trim().slice(0, 64) };
              var pFlexDir = typeof pcs.getPropertyValue === 'function' ? pcs.getPropertyValue('flex-direction') : pcs.flexDirection;
              if (typeof pFlexDir === 'string' && pFlexDir) {
                parentLayout.flexDirection = pFlexDir.trim().slice(0, 64);
              }
              snapshot.parentLayout = parentLayout;
            }
          }
        } catch (_) {}
      }
      if (el.parentElement.children && typeof el.parentElement.children.length === 'number') {
        try {
          var sibCount = 0;
          var sibIdx = -1;
          for (var i = 0; i < el.parentElement.children.length; i++) {
            var sib = el.parentElement.children[i];
            if (!sib || isOverlayNode(sib) || (sib.nodeType !== undefined && sib.nodeType !== 1)) continue;
            if (sib === el) sibIdx = sibCount;
            sibCount++;
          }
          if (sibIdx >= 0 && sibCount >= 1) {
            snapshot.siblingIndex = Math.min(10000, sibIdx);
            snapshot.siblingCount = Math.min(10000, sibCount);
          }
        } catch (_) {}
      }
    }

    if (el.children && typeof el.children.length === 'number') {
      try {
        var childList = [];
        var prefix = sourceEditContext ? sourceEditContext.previewRevision + ':' : '';
        for (var c = 0; c < el.children.length && childList.length < 24; c++) {
          var ch = el.children[c];
          if (!ch || isOverlayNode(ch) || (ch.nodeType !== undefined && ch.nodeType !== 1)) continue;
          var cTag = String(ch.tagName || '').toLowerCase();
          if (!/^[a-z][A-Za-z0-9-]{0,127}$/.test(cTag)) continue;
          var cSel = getXPath(ch);
          if (!cSel || cSel.length > 4000) continue;
          var summary = { selector: cSel, tagName: cTag };
          if (typeof ch.textContent === 'string') {
            var txt = ch.textContent.replace(/\\s+/g, ' ').trim();
            if (txt) summary.textPreview = txt.slice(0, 120);
          }
          if (prefix && ch.getAttribute) {
            var cMarker = ch.getAttribute('${SOURCE_EDIT_ATTRIBUTE}');
            if (typeof cMarker === 'string' && cMarker.indexOf(prefix) === 0) {
              var cTargetId = cMarker.slice(prefix.length);
              if (/^\\d{1,10}:\\d{1,10}$/.test(cTargetId) && Object.prototype.hasOwnProperty.call(sourceEditContext.targets, cTargetId)) {
                summary.targetId = cTargetId;
              }
            }
          }
          childList.push(summary);
        }
        snapshot.children = childList;
      } catch (_) {}
    }

    try {
      var meta = {};
      var rawClass = typeof el.className === 'string'
        ? el.className
        : (el.getAttribute ? el.getAttribute('class') : null);
      if (typeof rawClass === 'string' && rawClass.length > 0) meta.className = rawClass.slice(0, 4000);
      if (typeof el.id === 'string' && el.id.length > 0) meta.id = el.id.slice(0, 256);
      if (el.getAttribute) {
        var href = el.getAttribute('href');
        if (typeof href === 'string') meta.href = href.slice(0, 2048);
        var src = el.getAttribute('src');
        if (typeof src === 'string') meta.src = src.slice(0, 2048);
      }
      if (String(el.tagName || '').toLowerCase() === 'img') {
        if (typeof el.naturalWidth === 'number' && Number.isFinite(el.naturalWidth) && el.naturalWidth >= 0) {
          meta.naturalWidth = el.naturalWidth;
        }
        if (typeof el.naturalHeight === 'number' && Number.isFinite(el.naturalHeight) && el.naturalHeight >= 0) {
          meta.naturalHeight = el.naturalHeight;
        }
      }
      if (Object.keys(meta).length > 0) snapshot.elementMeta = meta;
    } catch (_) {}

    return snapshot;
  }

  function emitSourceSelection(el) {
    if (!el || !el.getBoundingClientRect) return;
    pendingRestoreSelector = null;
    pendingRestoreAttempts = 0;
    if (previewState && previewState.el !== el) revertPreview();
    var provenance = sourceEditSelection(el);
    var held = previewState && previewState.el === el ? previewState.request : null;
    if (held) revertPreview();
    var rect;
    var selector;
    var selectedHtml;
    var parentHtml;
    var ancestors;
    var snapshot;
    try {
      rect = el.getBoundingClientRect();
      selector = getXPath(el);
      selectedHtml = selectionHtml(el);
      parentHtml = parentHtmlOf(el);
      ancestors = sourceAncestors(el);
      snapshot = collectElementSnapshot(el, rect);
    } finally {
      if (held) applyPreview(el, held);
    }
    clearHover();
    pinElement(el, selector, false);
    pinnedSourceEditSignature = JSON.stringify(provenance);
    var selection = {
      __codesign: true, type: 'ELEMENT_SELECTED', selector: selector,
      tag: String(el.tagName).toLowerCase(), outerHTML: selectedHtml,
      parentOuterHTML: parentHtml,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      sourceEditAncestors: ancestors,
      sourceEditRevision: { sourceHash: sourceEditContext.sourceHash, previewRevision: sourceEditContext.previewRevision },
      elementSnapshot: snapshot
    };
    if (provenance) selection.sourceEdit = provenance;
    window.parent.postMessage(selection, '*');
  }

  function elementUnderEditLayer(x, y) {
    var hit = null;
    if (!editHitLayer) {
      hit = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
      return hit && isOverlayNode(hit) ? null : hit;
    }
    editHitLayer.style.pointerEvents = 'none';
    if (hudHost && hudHost.style) hudHost.style.pointerEvents = 'none';
    try {
      hit = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
      return hit && isOverlayNode(hit) ? null : hit;
    } finally {
      editHitLayer.style.pointerEvents = 'auto';
    }
  }

  function onDblClick(e) {
    if (currentMode !== 'source-edit' || !sourceEditContext) return;
    if (e && e.__csHandled) return;
    if (e) e.__csHandled = true;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    var hit = e && (e.target === editHitLayer || !e.target)
      ? elementUnderEditLayer(e.clientX, e.clientY)
      : (e ? e.target : null);
    if (hit && !isOverlayNode(hit) && (!pinned || (hit !== pinned && !(pinned.contains && pinned.contains(hit))))) {
      emitSourceSelection(hit);
    }
    if (!pinned || pinned.isConnected === false || !pinned.getBoundingClientRect) return;
    var provenance = sourceEditSelection(pinned);
    if (!provenance) return;

    var textKey = null;
    var textValue = null;
    var itemIdx = findItemIndex(pinned);
    var fieldPlan = sourceEditContext.fieldPlans && sourceEditContext.fieldPlans[provenance.targetId];
    if (provenance.fieldStates) {
      for (var i = 0; i < provenance.fieldStates.length; i++) {
        var fs = provenance.fieldStates[i];
        if (fs.status === 'ready' && (fs.key.indexOf('text:') === 0 || fs.key.indexOf('map-text:') === 0)) {
          textKey = fs.key;
          break;
        }
      }
      if (textKey && fieldPlan && fieldPlan.editableFields) {
        if (previewState && previewState.el === pinned && previewState.request && previewState.request.texts && typeof previewState.request.texts[textKey] === 'string') {
          textValue = previewState.request.texts[textKey];
        } else {
          for (var j = 0; j < fieldPlan.editableFields.length; j++) {
            var op = fieldPlan.editableFields[j];
            var opKey = op.kind === 'set-text'
              ? 'text:' + (op.textId || 'only')
              : op.kind === 'set-map-item-text'
                ? 'map-text:' + op.itemIndex + ':' + op.fieldKey
                : '';
            if (opKey === textKey) {
              textValue = op.value;
              break;
            }
          }
        }
      }
    }
    if ((textKey === null || textValue === null) && itemIdx !== undefined && sourceEditContext.mapSources) {
      var mapSrc = sourceEditContext.mapSources[provenance.targetId];
      if (mapSrc && mapSrc.fields && mapSrc.fields.length) {
        var mField = mapSrc.fields[0];
        if (mField && mField.values && typeof mField.values[itemIdx] === 'string') {
          textKey = 'map-text:' + itemIdx + ':' + mField.key;
          if (previewState && previewState.el === pinned && previewState.request && previewState.request.texts && typeof previewState.request.texts[textKey] === 'string') {
            textValue = previewState.request.texts[textKey];
          } else {
            textValue = mField.values[itemIdx];
          }
        }
      }
    }
    if ((textKey === null || textValue === null) && !fieldPlan && sourceEditContext.directTexts && Object.prototype.hasOwnProperty.call(sourceEditContext.directTexts, provenance.targetId)) {
      textKey = 'text:only';
      if (previewState && previewState.el === pinned && previewState.request && previewState.request.texts && typeof previewState.request.texts[textKey] === 'string') {
        textValue = previewState.request.texts[textKey];
      } else {
        textValue = sourceEditContext.directTexts[provenance.targetId];
      }
    }
    if (textKey === null || typeof textValue !== 'string') return;

    var rect = pinned.getBoundingClientRect();
    var typography = {};
    try {
      if (typeof window.getComputedStyle === 'function') {
        var cs = window.getComputedStyle(pinned);
        if (cs) {
          for (var t = 0; t < TYPOGRAPHY_KEYS.length; t++) {
            var tk = TYPOGRAPHY_KEYS[t];
            var tv = typeof cs.getPropertyValue === 'function' ? cs.getPropertyValue(cssPropertyName(tk)) : cs[tk];
            if (typeof tv === 'string' && tv.trim()) typography[tk] = tv.trim().slice(0, 1000);
          }
        }
      }
    } catch (_) {}

    var payload = {
      __codesign: true,
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
      selector: getXPath(pinned),
      targetId: provenance.targetId,
      textKey: textKey,
      text: textValue,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      typography: typography,
      sourceHash: sourceEditContext.sourceHash,
      previewRevision: sourceEditContext.previewRevision
    };
    if (itemIdx !== undefined) payload.itemIndex = itemIdx;
    try {
      window.parent.postMessage(payload, '*');
    } catch (err) { warnOnce('postMessage SOURCE_EDIT_INLINE_EDIT_REQUEST failed', err); }
  }

  function syncEditHitLayer() {
    if (currentMode !== 'source-edit') {
      if (editHitLayer) editHitLayer.remove();
      editHitLayer = null;
      removeHud();
      return;
    }
    if (!editHitLayer) {
      editHitLayer = document.createElement('div');
      editHitLayer.setAttribute('data-codesign-edit-hit-layer', '');
      editHitLayer.setAttribute('aria-hidden', 'true');
      editHitLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:crosshair;touch-action:none';
      editHitLayer.addEventListener('dblclick', onDblClick, false);
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
    ensureHud();
  }

  function onEditPointer(e) {
    if (currentMode !== 'source-edit') return;
    var el = elementUnderEditLayer(e.clientX, e.clientY);
    if (e.type === 'pointerdown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (el) emitSourceSelection(el);
    } else {
      if (hovered !== el) {
        hovered = el;
        renderHud();
      }
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
      if (hit && !isOverlayNode(hit) && hit !== pinned) emitSourceSelection(hit);
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
      var selectedHtml = selectionHtml(el);
      var parentHtml = parentHtmlOf(el);
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
    // Default mode: block document navigation. The sandbox iframe has no
    // router, so a real location change blanks the preview. Same-document
    // screens use data-oc-screen; ordinary hash links only scroll.
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
          if (target.getAttribute && target.getAttribute('data-oc-screen') != null) {
            showScreen(target.id || target.getAttribute('data-oc-screen'));
            return;
          }
          target.scrollIntoView();
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function hasValidContextRevision(ctx) {
    return Boolean(
      ctx &&
      typeof ctx === 'object' &&
      typeof ctx.sourceHash === 'string' &&
      /^[a-f0-9]{64}$/.test(ctx.sourceHash) &&
      typeof ctx.previewRevision === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(ctx.previewRevision) &&
      ctx.targets &&
      typeof ctx.targets === 'object'
    );
  }

  function ensureEditListeners() {
    if (!sourceEditContext) return;
    var hasPointer = false;
    for (var i = 0; i < installs.length; i++) {
      if (installs[i].evt === 'pointerdown') { hasPointer = true; break; }
    }
    if (!hasPointer) {
      installs.push(
        { evt: 'pointerdown', fn: onEditPointer },
        { evt: 'pointermove', fn: onEditPointer },
        { evt: 'dblclick', fn: onDblClick }
      );
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
      renderHud();
      return;
    }
    if (data.type === 'SOURCE_EDIT_HUD_STATE') {
      if (currentMode !== 'source-edit' || !sourceEditContext || data.sourceHash !== sourceEditContext.sourceHash || data.previewRevision !== sourceEditContext.previewRevision) return;
      hudHighlightBoxModel = data.highlightBoxModel === true;
      renderHud();
      return;
    }
    if (data.type === 'SOURCE_EDIT_HOT_SWAP') {
      if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.requestId)) return;
      var failSwap = function(msg) {
        try {
          window.parent.postMessage({
            __codesign: true,
            type: 'SOURCE_EDIT_HOT_SWAPPED',
            requestId: data.requestId,
            ok: false,
            error: String(msg || 'Hot swap failed').slice(0, 2000)
          }, '*');
        } catch (_) {}
      };
      if (typeof window.__codesign_hot_swap__ !== 'function') {
        failSwap('Hot swap runtime unavailable.');
        return;
      }
      if (typeof data.instrumentedSource !== 'string' || !hasValidContextRevision(data.sourceEditContext) || (data.kind !== 'jsx' && data.kind !== 'tsx')) {
        failSwap('Invalid hot swap payload.');
        return;
      }
      var savedScrollX = typeof window.scrollX === 'number' ? window.scrollX : 0;
      var savedScrollY = typeof window.scrollY === 'number' ? window.scrollY : 0;
      var savedScreen = document.documentElement && document.documentElement.getAttribute
        ? document.documentElement.getAttribute('data-oc-active-screen')
        : null;
      if (textObserver && typeof textObserver.disconnect === 'function') {
        try { textObserver.disconnect(); } catch (_) {}
      }
      clearHover();
      clearPinned();
      watchedSelectors = [];
      sourceEditContext = data.sourceEditContext;
      ensureEditListeners();
      fieldBindings = new WeakMap();
      invalidTextFields = new WeakMap();
      mutationOverflow = false;
      pinnedSourceEditSignature = '';
      try {
        var swapped = window.__codesign_hot_swap__(data.instrumentedSource, data.kind);
        if (!swapped) {
          failSwap('Hot swap returned false.');
          return;
        }
        if (sourceEditContext && bindFields && window.MutationObserver && document.documentElement) {
          if (!textObserver) textObserver = new window.MutationObserver(processTextMutations);
          textObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
          processTextMutations([{ type: 'childList', target: document.documentElement, removedNodes: [], addedNodes: [document.documentElement] }]);
        }
        if (savedScreen) showScreen(savedScreen);
        else ensureScreens();
        if (typeof window.scrollTo === 'function') {
          try { window.scrollTo(savedScrollX, savedScrollY); } catch (_) {}
        }
        reattach();
        if (currentMode === 'source-edit' && typeof data.restoreSelector === 'string' && data.restoreSelector.length > 0 && data.restoreSelector.length <= 4000) {
          var restoredAfterSwap = resolveSelector(data.restoreSelector);
          if (restoredAfterSwap) {
            pendingRestoreSelector = null;
            pendingRestoreAttempts = 0;
            emitSourceSelection(restoredAfterSwap);
          } else {
            pendingRestoreSelector = data.restoreSelector;
            pendingRestoreAttempts = 15;
          }
        }
        window.parent.postMessage({
          __codesign: true,
          type: 'SOURCE_EDIT_HOT_SWAPPED',
          requestId: data.requestId,
          ok: true
        }, '*');
      } catch (err) {
        failSwap(err && err.message ? err.message : String(err));
      }
      return;
    }
    if (data.type === 'SOURCE_EDIT_PREVIEW' || data.type === 'SOURCE_EDIT_RESTORE') {
      if (currentMode !== 'source-edit' || !sourceEditContext || data.sourceHash !== sourceEditContext.sourceHash || data.previewRevision !== sourceEditContext.previewRevision) return;
      if (data.type === 'SOURCE_EDIT_RESTORE') {
        if (typeof data.selector !== 'string' || data.selector.length > 4000) return;
        var restored = resolveSelector(data.selector);
        if (restored) {
          pendingRestoreSelector = null;
          pendingRestoreAttempts = 0;
          emitSourceSelection(restored);
        } else {
          pendingRestoreSelector = data.selector;
          pendingRestoreAttempts = 15;
        }
        return;
      }
      var styles = data.styles && typeof data.styles === 'object' ? data.styles : {};
      var removedStyles = Array.isArray(data.removedStyles) ? data.removedStyles : [];
      var attributes = data.attributes && typeof data.attributes === 'object' ? data.attributes : {};
      var texts = data.texts && typeof data.texts === 'object' ? data.texts : {};
      var className = typeof data.className === 'string' ? data.className : undefined;
      var hidden = typeof data.hidden === 'boolean' ? data.hidden : undefined;
      var hasDraft =
        Object.keys(styles).length > 0 ||
        removedStyles.length > 0 ||
        Object.keys(attributes).length > 0 ||
        Object.keys(texts).length > 0 ||
        className !== undefined ||
        hidden === true ||
        (hidden === false && pinned && pinned.hasAttribute && pinned.hasAttribute('hidden'));
      if (!pinned || !pinned.isConnected || !hasDraft) {
        revertPreview();
        renderHud();
        scheduleRectsBroadcast();
        return;
      }
      applyPreview(pinned, {
        styles: styles,
        removedStyles: removedStyles,
        attributes: attributes,
        texts: texts,
        className: className,
        hidden: hidden
      });
      renderHud();
      scheduleRectsBroadcast();
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
  ensureEditListeners();
  function showScreen(id) {
    var root = document.documentElement;
    if (!id || !root || !root.setAttribute || !document.querySelectorAll) return;
    root.setAttribute('data-oc-active-screen', id);
    var screens = document.querySelectorAll('[data-oc-screen]');
    var active = document.activeElement;
    var destination = null;
    var moveFocus = false;
    for (var i = 0; i < screens.length; i++) {
      var screen = screens[i];
      if (screen === root) continue;
      var name = screen.id || screen.getAttribute('data-oc-screen');
      if (name === id) {
        destination = screen;
        screen.removeAttribute('hidden');
      } else {
        if (active && screen.contains(active)) moveFocus = true;
        screen.setAttribute('hidden', '');
      }
    }
    if (moveFocus && destination) {
      if (!destination.hasAttribute('tabindex')) {
        destination.setAttribute('tabindex', '-1');
        // Keep the target focusable until blur; immediate removal can reset focus.
        destination.addEventListener('blur', function(e) {
          e.currentTarget.removeAttribute('tabindex');
        }, { once: true });
      }
      destination.focus({ preventScroll: true });
    }
  }
  function ensureScreens() {
    var root = document.documentElement;
    if (!root || !root.getAttribute || !document.querySelectorAll) return;
    var screens = document.querySelectorAll('[data-oc-screen]');
    if (!screens || !screens.length) return;
    if (!screenStyle) {
      screenStyle = document.createElement('style');
      // Authored grid/flex display rules otherwise override the native hidden style.
      screenStyle.textContent = ':root[data-oc-active-screen] [data-oc-screen][hidden]{display:none!important;}';
      root.appendChild(screenStyle);
    }
    var current = root.getAttribute('data-oc-active-screen');
    var first = null;
    for (var i = 0; i < screens.length; i++) {
      if (screens[i] === root) continue;
      if (!first) first = screens[i];
      var name = screens[i].id || screens[i].getAttribute('data-oc-screen');
      if (current && name === current) {
        showScreen(current);
        return;
      }
    }
    if (first) showScreen(first.id || first.getAttribute('data-oc-screen'));
  }
  function reattach() {
    if (currentMode === 'source-edit') {
      syncEditHitLayer();
      if (pendingRestoreSelector) {
        var restoredNow = resolveSelector(pendingRestoreSelector);
        if (restoredNow) {
          pendingRestoreSelector = null;
          pendingRestoreAttempts = 0;
          emitSourceSelection(restoredNow);
        } else if (--pendingRestoreAttempts <= 0) {
          pendingRestoreSelector = null;
        }
      }
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
    ensureScreens();
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
  elementSnapshot?: SourceEditElementSnapshot;
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
    (d.elementSnapshot === undefined ||
      SourceEditElementSnapshot.safeParse(d.elementSnapshot).success) &&
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

export interface SourceEditInlineEditRequestMessage {
  __codesign: true;
  type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST';
  selector: string;
  targetId: string;
  textKey: string;
  text: string;
  itemIndex?: number;
  rect: { top: number; left: number; width: number; height: number };
  typography: Record<string, string>;
  sourceHash: string;
  previewRevision: string;
}

const VALID_TYPOGRAPHY_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'color',
]);

export function isSourceEditInlineEditRequestMessage(
  data: unknown,
): data is SourceEditInlineEditRequestMessage {
  if (typeof data !== 'object' || data === null) return false;
  if (!isSourceEditRevision(data)) return false;
  const d = data as Partial<SourceEditInlineEditRequestMessage>;
  if (d.__codesign !== true || d.type !== 'SOURCE_EDIT_INLINE_EDIT_REQUEST') return false;
  if (typeof d.selector !== 'string' || d.selector.length === 0 || d.selector.length > 8192) {
    return false;
  }
  if (typeof d.targetId !== 'string' || !/^\d{1,10}:\d{1,10}$/.test(d.targetId)) return false;
  if (
    typeof d.textKey !== 'string' ||
    !/^(?:text:(?:only|\d{1,10}:\d{1,10})|map-text:\d{1,4}:.{1,128})$/.test(d.textKey)
  ) {
    return false;
  }
  if (typeof d.text !== 'string' || d.text.length > 100_000) return false;
  if (
    d.itemIndex !== undefined &&
    (typeof d.itemIndex !== 'number' ||
      !Number.isInteger(d.itemIndex) ||
      d.itemIndex < 0 ||
      d.itemIndex > 10_000)
  ) {
    return false;
  }
  if (!isElementRect(d.rect)) return false;
  if (typeof d.typography !== 'object' || d.typography === null || Array.isArray(d.typography)) {
    return false;
  }
  for (const [key, val] of Object.entries(d.typography)) {
    if (!VALID_TYPOGRAPHY_KEYS.has(key) || typeof val !== 'string' || val.length > 1000) {
      return false;
    }
  }
  return true;
}

export interface SourceEditHotSwappedMessage {
  __codesign: true;
  type: 'SOURCE_EDIT_HOT_SWAPPED';
  requestId: string;
  ok: boolean;
  error?: string;
}

export function isSourceEditHotSwappedMessage(data: unknown): data is SourceEditHotSwappedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Partial<SourceEditHotSwappedMessage>;
  return (
    d.__codesign === true &&
    d.type === 'SOURCE_EDIT_HOT_SWAPPED' &&
    typeof d.requestId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(d.requestId) &&
    typeof d.ok === 'boolean' &&
    (d.error === undefined || (typeof d.error === 'string' && d.error.length <= 2_000))
  );
}
