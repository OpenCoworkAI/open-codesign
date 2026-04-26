/**
 * In-iframe bridge for live EDITMODE token updates.
 *
 * Without this, every token edit forced a full srcdoc reload — re-mounting React,
 * re-initialising Babel, and re-running the agent script (~300-500ms blank flash).
 *
 * With this, the host posts `{type: 'codesign:tweaks:update', tokens}` to the
 * iframe; the bridge substitutes the EDITMODE block in the cached agent script,
 * re-compiles via Babel, and re-renders into the same React root. React's
 * reconciler diffs the tree → DOM patches in place, no flash.
 *
 * Bundled as a string at build time; injected by `wrapJsxAsSrcdoc`.
 */

export const TWEAKS_BRIDGE_SETUP = `(function() {
  'use strict';
  if (!window.ReactDOM || typeof window.ReactDOM.createRoot !== 'function') return;
  window.__codesign_tweaks__ = { root: null, originalScript: null, transformOptions: null };
  var origCreateRoot = window.ReactDOM.createRoot;
  window.ReactDOM.createRoot = function(el) {
    if (window.__codesign_tweaks__.root) return window.__codesign_tweaks__.root;
    var root = origCreateRoot.call(this, el);
    window.__codesign_tweaks__.root = root;
    return root;
  };
})();`;

export const TWEAKS_BRIDGE_LISTENER = `(function() {
  'use strict';
  if (!window.__codesign_tweaks__) return;
  var EDITMODE_RE = /\\/\\*EDITMODE-BEGIN\\*\\/[\\s\\S]*?\\/\\*EDITMODE-END\\*\\//;
  function applyTokens(tokens) {
    var state = window.__codesign_tweaks__;
    if (!state.originalScript || !state.root || !window.Babel) return;
    var json;
    try { json = JSON.stringify(tokens, null, 2); } catch (_) { return; }
    var nextScript = state.originalScript.replace(
      EDITMODE_RE,
      '/*EDITMODE-BEGIN*/' + json + '/*EDITMODE-END*/'
    );
    var compiled;
    try {
      compiled = window.Babel.transform(
        nextScript,
        state.transformOptions || { presets: ['react'] }
      ).code;
    } catch (err) {
      console.warn('[tweaks-bridge] babel compile failed:', err && err.message);
      return;
    }
    try {
      // ReactDOM.createRoot is intercepted to return the cached root, so the
      // agent's own \`createRoot(...).render(<App/>)\` call inside the re-eval
      // becomes an in-place re-render of the same root.
      new Function('React', 'ReactDOM', compiled)(window.React, window.ReactDOM);
    } catch (err) {
      console.warn('[tweaks-bridge] re-eval failed:', err && err.message);
    }
  }
  window.addEventListener('message', function(event) {
    var data = event && event.data;
    if (!data || data.type !== 'codesign:tweaks:update') return;
    if (!data.tokens || typeof data.tokens !== 'object') return;
    applyTokens(data.tokens);
  });
})();`;
