/**
 * In-iframe bridge for live EDITMODE token updates.
 *
 * Without this, every token edit forced a full srcdoc reload or a full JSX
 * recompilation — re-mounting React, re-initialising Babel, and re-running the
 * agent script (~300-500ms blank flash).
 *
 * With this, the host posts `{type: 'codesign:tweaks:update', tokens}` to the
 * iframe. The bridge updates the runtime-owned token object, maps primitives to
 * canonical CSS custom properties, and renders the existing React element again
 * on the next animation frame. Component types and module scope stay intact:
 * rerunning the module would redefine component functions and discard hook state.
 *
 * Bundled as a string at build time; injected by `wrapJsxAsSrcdoc`.
 */

export interface TweakCompatibilityNotice {
  type: 'codesign:tweaks:compatibility';
  message: string;
}

export function isTweakCompatibilityNotice(data: unknown): data is TweakCompatibilityNotice {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'codesign:tweaks:compatibility' &&
    'message' in data &&
    typeof data.message === 'string'
  );
}

export const TWEAKS_BRIDGE_SETUP = `(function() {
  'use strict';
  if (!window.ReactDOM || typeof window.ReactDOM.createRoot !== 'function') return;
  var EDITMODE_RE = /\\/\\*\\s*EDITMODE-BEGIN\\s*\\*\\/[\\s\\S]*?\\/\\*\\s*EDITMODE-END\\s*\\*\\//;
  var state = {
    root: null,
    tokens: {},
    element: null,
    render: null,
    module: null,
    moduleRunning: false,
    replayReason: null,
    warned: false,
    renderPending: false
  };
  // Plain accessor properties preserve structuredClone/JSON compatibility.
  var liveTokens = {};
  function defineToken(key, value) {
    state.tokens[key] = value;
    Object.defineProperty(liveTokens, key, {
      enumerable: true,
      configurable: true,
      get: function() {
        if (state.moduleRunning) {
          state.replayReason = 'token values are captured outside component rendering';
        }
        return state.tokens[key];
      },
      set: function(next) { state.tokens[key] = next; }
    });
  }
  var origCreateElement = window.React.createElement;
  // Cached closures can capture a token before the hook executes; observing
  // factory reads alone cannot distinguish those from token-independent hooks.
  ['useMemo', 'useCallback'].forEach(function(name) {
    var original = window.React[name];
    window.React[name] = function() {
      state.replayReason = 'memoization hooks may capture live token values';
      return original.apply(this, arguments);
    };
  });
  window.React.createElement = function(type) {
    if (type && (type.$$typeof === Symbol.for('react.memo') ||
        (type.prototype && (type.prototype.isPureReactComponent || type.prototype.shouldComponentUpdate)))) {
      state.replayReason = 'memoized components may skip live token updates';
    }
    return origCreateElement.apply(this, arguments);
  };
  var origCreateRoot = window.ReactDOM.createRoot;
  window.ReactDOM.createRoot = function(el) {
    if (state.root) return state.root;
    var root = origCreateRoot.call(this, el);
    state.root = root;
    state.render = root.render.bind(root);
    root.render = function(element) {
      state.element = element;
      if (element !== null && (!window.React.isValidElement(element) ||
          (typeof element.type !== 'function' && typeof element.type !== 'object'))) {
        state.replayReason = 'the root is static JSX, a fragment, or an array rather than a component';
      }
      return state.render(element);
    };
    return root;
  };
  function toKebab(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[_\\s]+/g, '-')
      .replace(/[^A-Za-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }
  function cssValue(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    return null;
  }
  function applyCssVars(tokens) {
    if (!tokens || typeof tokens !== 'object') return false;
    var root = document.documentElement;
    for (var key in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, key)) continue;
      var name = toKebab(key);
      var value = cssValue(tokens[key]);
      if (!name || value === null) continue;
      root.style.setProperty('--ocd-tweak-' + name, value);
    }
    return true;
  }
  function replaceTokens(tokens) {
    for (var existing in state.tokens) {
      if (Object.prototype.hasOwnProperty.call(state.tokens, existing)) {
        delete state.tokens[existing];
        delete liveTokens[existing];
      }
    }
    if (tokens && typeof tokens === 'object') {
      for (var key in tokens) {
        if (Object.prototype.hasOwnProperty.call(tokens, key)) defineToken(key, tokens[key]);
      }
    }
    applyCssVars(state.tokens);
  }
  function parseInitialTokens(source) {
    var match = String(source || '').match(EDITMODE_RE);
    if (!match) return null;
    var body = match[0]
      .replace(/^\\/\\*\\s*EDITMODE-BEGIN\\s*\\*\\//, '')
      .replace(/\\/\\*\\s*EDITMODE-END\\s*\\*\\/$/, '')
      .trim();
    if (!body) return {};
    return JSON.parse(body);
  }
  function scheduleRender() {
    if (state.renderPending || typeof state.render !== 'function') return;
    state.renderPending = true;
    var raf = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 0); };
    raf(function() {
      state.renderPending = false;
      if (state.replayReason && state.module) {
        if (!state.warned) {
          state.warned = true;
          window.parent.postMessage({
            type: 'codesign:tweaks:compatibility',
            message: 'Live tweak compatibility mode: ' + state.replayReason +
              '. Updating tweaks reinitializes artifact state. Read tokens inside non-memoized components to preserve interaction state.',
          }, '*');
        }
        state.module();
        return;
      }
      var element = state.element;
      if (window.React.isValidElement(element)) {
        element = window.React.cloneElement(element);
      }
      state.render(element);
    });
  }
  window.__codesign_tweaks__ = {
    tokens: liveTokens,
    applyCssVars: applyCssVars,
    applyTokens: function(tokens) {
      var keys = Object.keys(tokens);
      if (keys.length === Object.keys(state.tokens).length &&
          keys.every(function(key) { return Object.prototype.hasOwnProperty.call(state.tokens, key) &&
            state.tokens[key] === tokens[key]; })) return;
      replaceTokens(tokens);
      scheduleRender();
    },
    applyInitial: function(source) {
      replaceTokens(parseInitialTokens(source));
    },
    runModule: function(run) {
      state.module = run;
      state.moduleRunning = true;
      try { run(); }
      finally { state.moduleRunning = false; }
    }
  };
})();`;

export const TWEAKS_BRIDGE_LISTENER = `(function() {
  'use strict';
  if (!window.__codesign_tweaks__ || typeof window.__codesign_tweaks__.applyTokens !== 'function') return;
  window.addEventListener('message', function(event) {
    var data = event && event.data;
    if (!data || data.type !== 'codesign:tweaks:update') return;
    if (!data.tokens || typeof data.tokens !== 'object') return;
    window.__codesign_tweaks__.applyTokens(data.tokens);
  });
})();`;
