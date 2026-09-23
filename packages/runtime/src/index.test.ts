import { describe, expect, it } from 'vitest';
import {
  buildInteractivePreviewDocument,
  buildPreviewDocument,
  buildSrcdoc,
  buildStandaloneDocument,
  classifyRenderableSource,
  extractAndUpgradeArtifact,
  findArtifactSourceReference,
  INTERACTIVE_PREVIEW_SANDBOX,
  resolveArtifactSourceReferencePath,
} from './index';

function compiledArtifactSource(document: string): string {
  const compiled = [...document.matchAll(/var source = ([^\n]+);\n {2}var options = /g)].at(
    -1,
  )?.[1];
  if (!compiled) throw new Error('Missing compiled artifact source');
  return JSON.parse(compiled) as string;
}
describe('interactive preview form policy', () => {
  it.each([
    ['App.jsx', 'function App(){return <form><button>Save</button></form>}'],
    [
      'index.html',
      '<html lang="en"><script>window.early=true</script><head></head><body><form></form></body></html>',
    ],
  ])('keeps trusted policy first through %s round trips without changing exports', (path, source) => {
    const first = buildInteractivePreviewDocument(source, { path });
    const second = buildInteractivePreviewDocument(first, { path, baseHref: 'file:///workspace/' });
    for (const document of [first, second]) {
      expect(document).toMatch(/^<!doctype html>\s*<meta http-equiv="Content-Security-Policy"/u);
      expect(document.match(/data-codesign-form-policy/gu)).toHaveLength(1);
      expect(document).toContain('content="form-action \'none\'"');
    }
    expect(second).toContain('<base href="file:///workspace/"');
    expect(buildStandaloneDocument(source, { path })).not.toContain('data-codesign-form-policy');
    expect(INTERACTIVE_PREVIEW_SANDBOX.split(' ')).toEqual(['allow-scripts', 'allow-forms']);
  });
});

describe.each([
  ['preview', buildPreviewDocument],
  ['standalone', buildStandaloneDocument],
] as const)('%s runtime fonts', (_name, build) => {
  it.each([
    'function App(){return <p>Hello</p>}',
    'function App(){return <p style={{fontFamily:"system-ui, Arial, sans-serif"}}>Hello</p>}',
    'function App(){return <p style={{fontFamily:"My-Fraunces, JetBrains Mono Custom"}}>Hello</p>}',
  ])('does not contact font services for a source without supported families', (source) => {
    const out = build(source, { path: 'App.jsx' });
    expect(out).not.toContain('fonts.googleapis.com');
    expect(out).not.toContain('fonts.gstatic.com');
    expect(out).not.toContain('rel="preconnect"');
    expect(out).toContain('body{font-family:system-ui,sans-serif;');
  });

  it.each([
    ['Fraunces', 'Fraunces:ital,opsz,wght@'],
    ['DM Serif Display', 'DM+Serif+Display:ital@'],
    ['DM Sans', 'DM+Sans:opsz,wght@'],
    ['JetBrains Mono', 'JetBrains+Mono:wght@'],
  ])('loads only explicitly referenced %s', (family, query) => {
    const out = build(`function App(){return <p style={{fontFamily:"${family}"}}>Hello</p>}`);
    const link = out.match(/<link data-codesign-runtime-fonts[^>]+>/)?.[0];
    expect(link).toContain(`family=${query}`);
    expect(link?.match(/family=/g)).toHaveLength(1);
    expect(out.match(/data-codesign-runtime-fonts/g)).toHaveLength(1);
    expect(out.match(/rel="preconnect"/g)).toHaveLength(2);
  });

  it('deduplicates families from CSS, token values and Tailwind arbitrary font names', () => {
    const source = `const headingFont = "Fraunces";
function App(){return <><style>{".body{font-family:'DM Sans',sans-serif}"}</style><p style={{fontFamily:headingFont}}>Title</p><p className="font-['DM_Sans']">Body</p></>}`;
    const out = build(source);
    const link = out.match(/<link data-codesign-runtime-fonts[^>]+>/)?.[0];
    expect(link?.match(/family=/g)).toHaveLength(2);
    expect(link).toContain('family=Fraunces:');
    expect(link).toContain('family=DM+Sans:');
    expect(link).not.toContain('JetBrains');
    expect(link).not.toContain('Serif');
  });
});

describe('buildSrcdoc', () => {
  it('strips CSP meta tags', () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"></head><body></body></html>';
    const out = buildSrcdoc(html);
    expect(out).not.toContain('Content-Security-Policy');
  });

  it('keeps legacy full-HTML documents as HTML but injects the preview overlay', () => {
    // Snapshots written before the JSX-only switchover contain raw HTML
    // documents. Wrapping those as JSX makes Babel bark on the DOCTYPE /
    // <html> tokens, so buildSrcdoc injects the preview overlay without
    // routing them through the React+Babel wrapper.
    const html = '<html><body><p>x</p></body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('<p>x</p>');
    expect(out).toContain('CODESIGN_OVERLAY_SCRIPT');
    expect(out).toContain('ELEMENT_SELECTED');
    expect(out).not.toContain('AGENT_BODY_BEGIN');

    const doctyped = '<!DOCTYPE html><html><body><p>y</p></body></html>';
    const doctypedOut = buildSrcdoc(doctyped);
    expect(doctypedOut).toContain('<p>y</p>');
    expect(doctypedOut).toContain('CODESIGN_OVERLAY_SCRIPT');
    expect(doctypedOut).not.toContain('AGENT_BODY_BEGIN');
  });

  it('does not duplicate the overlay when a full-HTML document is rebuilt', () => {
    const once = buildSrcdoc('<html><body><p>x</p></body></html>');
    const twice = buildSrcdoc(once);
    expect(twice).toBe(once);
  });

  it('injects preview viewport support into full-HTML documents without duplicating viewport meta', () => {
    const out = buildSrcdoc(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><p>x</p></body></html>',
    );
    expect(out).toContain('OPEN-CODESIGN-PREVIEW-VIEWPORT');
    expect(out).toContain('--codesign-preview-width');
    expect(out.match(/name="viewport"/g)).toHaveLength(1);
  });

  it('injects the JSX runtime stack when a full-HTML payload uses <script type="text/babel">', () => {
    const mixed = [
      '<!doctype html>',
      '<html><head><title>mixed</title></head><body>',
      '<div id="root"></div>',
      '<script type="text/babel" data-presets="react">',
      'function App() { return <div>mixed</div>; }',
      'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      '</script>',
      '</body></html>',
    ].join('\n');
    const out = buildSrcdoc(mixed);
    expect(out).toContain('CODESIGN_JSX_RUNTIME');
    expect(out).toContain('IOSDevice');
    expect(out).toContain('DesignCanvas');
    expect(out).toContain('CODESIGN_OVERLAY_SCRIPT');
    // Still the HTML passthrough — not wrapped as JSX.
    expect(out).not.toContain('AGENT_BODY_BEGIN');
  });

  it('injects the JSX runtime when the HTML payload references IOSDevice / ReactDOM.createRoot even without type="text/babel"', () => {
    const html =
      '<!doctype html><html><body><div id="root"></div>' +
      '<script>ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(IOSDevice));</script>' +
      '</body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('CODESIGN_JSX_RUNTIME');
  });

  it('does NOT inject the JSX runtime into pure HTML + CDN libs (Chart.js style)', () => {
    const pureHtml =
      '<!doctype html><html><body>' +
      '<canvas id="c"></canvas>' +
      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>' +
      '<script>new Chart(document.getElementById("c"), { type: "bar", data: {} });</script>' +
      '</body></html>';
    const out = buildSrcdoc(pureHtml);
    expect(out).not.toContain('CODESIGN_JSX_RUNTIME');
    // Overlay still there for element selection / error reporting.
    expect(out).toContain('CODESIGN_OVERLAY_SCRIPT');
  });

  it('does not double-inject the JSX runtime when a mixed document is rebuilt', () => {
    const mixed =
      '<!doctype html><html><body>' +
      '<script type="text/babel">ReactDOM.createRoot(document.getElementById("root")).render(<App/>);</script>' +
      '</body></html>';
    const once = buildSrcdoc(mixed);
    const twice = buildSrcdoc(once);
    expect(twice).toBe(once);
  });

  it('removes user-added React/Babel CDN runtime scripts from mixed HTML previews', () => {
    const mixed = [
      '<!doctype html>',
      '<html><head>',
      '<script crossorigin src="https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js"></script>',
      '<script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
      '</head><body><div id="root"></div>',
      '<script type="text/babel">function App(){ return <div>mixed</div>; } ReactDOM.createRoot(document.getElementById("root")).render(<App/>);</script>',
      '</body></html>',
    ].join('\n');

    const out = buildSrcdoc(mixed);
    expect(out).toContain('CODESIGN_JSX_RUNTIME');
    expect(out).not.toContain('cdn.jsdelivr.net/npm/react@18/umd/react.development.js');
    expect(out).not.toContain('cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js');
    expect(out).not.toContain('cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js');
    expect(out).toContain('cdn.jsdelivr.net/npm/chart.js');
  });

  it('marks inline JSX scripts as text/babel before injecting the runtime', () => {
    const html =
      '<!doctype html><html><body><div id="root"></div>' +
      '<script>function App(){ return <div>mixed</div>; } ReactDOM.createRoot(document.getElementById("root")).render(<App/>);</script>' +
      '</body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('CODESIGN_JSX_RUNTIME');
    expect(out).toContain('<script type="text/babel">function App()');
  });

  it('wraps a fragment via the JSX path (no legacy HTML branch)', () => {
    const out = buildSrcdoc('<div>plain</div>');
    expect(out).toContain('AGENT_BODY_BEGIN');
    expect(out).toContain('window.Babel.transform');
    expect(compiledArtifactSource(out)).toBe('<div>plain</div>');
  });
});

describe('buildSrcdoc — JSX path', () => {
  const jsxArtifact = `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/;
function App() { return <div>hi</div>; }
ReactDOM.createRoot(document.getElementById("root")).render(<App/>);`;

  it('routes JSX artifacts through the React+Babel template', () => {
    const out = buildSrcdoc(jsxArtifact);
    expect(out).toContain('AGENT_BODY_BEGIN');
    expect(out).toContain('AGENT_BODY_END');
    expect(out).toContain('window.Babel.transform');
    // Vendored runtime + frame snippets must be inlined.
    expect(out).toContain('IOSDevice');
    expect(out).toContain('DesignCanvas');
    // Overlay still present so element-selection / error reporting work.
    expect(out).toContain('ELEMENT_SELECTED');
    // The agent's payload is embedded between the markers.
    expect(out).toContain('TWEAK_DEFAULTS');
  });

  it('hydrates tweak CSS variables before running the artifact script', () => {
    const out = buildSrcdoc(jsxArtifact);

    expect(out.indexOf('applyInitial')).toBeGreaterThan(-1);
    expect(out.indexOf('applyInitial')).toBeLessThan(out.indexOf('AGENT_BODY_BEGIN'));
    expect(out).toContain('--ocd-tweak-');
    expect(out).toContain('window.__codesign_tweaks__.tokens');
    expect(out).not.toContain('registerRunner(runner)');
    expect(out).not.toContain('originalScript');
  });

  it('runs the artifact module once and leaves live rerenders to the existing React root', () => {
    const out =
      buildSrcdoc(`const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#000"}/*EDITMODE-END*/;
function App() { return <main style={{ color: TWEAK_DEFAULTS.accent }}>hi</main>; }
ReactDOM.createRoot(document.getElementById("root")).render(<App/>);`);

    expect(out).toContain('window.__codesign_tweaks__.tokens');
    expect(out).not.toContain('registerRunner(runner)');
    expect(out).toContain('window.React.cloneElement(element)');
  });

  it('detects JSX via ReactDOM.createRoot signature even without EDITMODE', () => {
    const src = `function App() { return <div/>; } ReactDOM.createRoot(document.getElementById("root")).render(<App/>);`;
    const out = buildSrcdoc(src);
    expect(out).toContain('AGENT_BODY_BEGIN');
  });

  it('extractAndUpgradeArtifact wraps JSX payloads', () => {
    const wrapped = extractAndUpgradeArtifact(jsxArtifact);
    expect(wrapped).toContain('AGENT_BODY_BEGIN');
    expect(wrapped).toContain('TWEAK_DEFAULTS');
  });

  it('extractAndUpgradeArtifact also wraps bare HTML (JSX-only contract)', () => {
    const wrapped = extractAndUpgradeArtifact('<html><body>x</body></html>');
    expect(wrapped).toContain('AGENT_BODY_BEGIN');
    expect(wrapped).toContain('window.Babel.transform');
  });

  it('extractAndUpgradeArtifact passes already-wrapped payloads through unchanged', () => {
    const wrapped = extractAndUpgradeArtifact(jsxArtifact);
    const wrappedTwice = extractAndUpgradeArtifact(wrapped);
    expect(wrappedTwice).toBe(wrapped);
  });

  it('buildSrcdoc passes already-wrapped payloads through unchanged', () => {
    const wrapped = buildSrcdoc(jsxArtifact);
    const wrappedTwice = buildSrcdoc(wrapped);
    expect(wrappedTwice).toBe(wrapped);
  });
});

describe('buildStandaloneDocument', () => {
  it('exports bare JSX as browser-openable HTML with an inline runtime', () => {
    const out = buildStandaloneDocument(
      'function App() { return <div>hi</div>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      { path: 'index.html' },
    );
    expect(out).toContain('CODESIGN_STANDALONE_RUNTIME');
    expect(out).toContain('window.Babel.transform');
    expect(out).toContain('<div id="root"></div>');
    expect(out).not.toContain('CODESIGN_OVERLAY_SCRIPT');
  });

  it('initializes EDITMODE CSS variables in standalone JSX exports', () => {
    const out = buildStandaloneDocument(
      'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accentColor":"red"}/*EDITMODE-END*/;\nfunction App() { return <main style={{ color: "var(--ocd-tweak-accent-color)" }}>hi</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      { path: 'App.jsx' },
    );

    expect(out).toContain('window.__codesign_tweaks__');
    expect(out).toContain('applyInitial');
    expect(out.indexOf('applyInitial')).toBeLessThan(out.lastIndexOf('Babel.transform'));
  });

  it('exports mixed HTML without external React/Babel CDN scripts or preview overlay', () => {
    const out = buildStandaloneDocument(
      [
        '<!doctype html><html><head>',
        '<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js"></script>',
        '</head><body><div id="root"></div>',
        '<script>function App(){ return <div>hi</div>; } ReactDOM.createRoot(document.getElementById("root")).render(<App/>);</script>',
        '</body></html>',
      ].join('\n'),
      { path: 'index.html' },
    );
    expect(out).toContain('CODESIGN_STANDALONE_RUNTIME');
    expect(out).toContain('<script type="text/babel">function App()');
    expect(out).not.toContain('cdn.jsdelivr.net/npm/react@18');
    expect(out).not.toContain('CODESIGN_OVERLAY_SCRIPT');
  });
});

describe('standalone renderable classification', () => {
  it('classifies renderable file paths and rejects non-renderable paths', () => {
    expect(classifyRenderableSource('<main/>', 'index.html')).toBe('html');
    expect(classifyRenderableSource('function App(){ return <main/>; }', 'App.jsx')).toBe('jsx');
    expect(
      classifyRenderableSource('function App(): JSX.Element { return <main/>; }', 'App.tsx'),
    ).toBe('tsx');
    expect(classifyRenderableSource('<!doctype html><html><body>x</body></html>', 'demo.jsx')).toBe(
      'html',
    );
    expect(classifyRenderableSource('body {}', 'style.css')).toBe('unknown');
  });

  it('injects a base href into HTML preview documents', () => {
    const out = buildPreviewDocument('<!doctype html><html><head></head><body>x</body></html>', {
      path: 'index.html',
      baseHref: 'file:///tmp/workspace/',
    });
    expect(out).toContain('<base href="file:///tmp/workspace/" />');
  });

  it('auto-mounts JSX snippets that define _App without an explicit root render', () => {
    const out = buildPreviewDocument('function _App() { return <div>hi</div>; }', {
      path: 'demo.jsx',
    });
    expect(compiledArtifactSource(out)).toContain(
      "ReactDOM.createRoot(document.getElementById('root')).render(<_App />);",
    );
  });

  it('preserves explicit mount code without adding an _App fallback', () => {
    const out = buildPreviewDocument(
      'function App() { return <div>hi</div>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      { path: 'demo.jsx' },
    );
    expect(compiledArtifactSource(out)).toContain('render(<App/>);');
    expect(compiledArtifactSource(out)).not.toContain('render(<_App />);');
  });

  it('uses the TypeScript Babel preset for TSX files', () => {
    const out = buildPreviewDocument(
      'function App(): JSX.Element { const label: string = "typed"; return <div>{label}</div>; }',
      { path: 'App.tsx' },
    );
    expect(out).toContain('"filename":"artifact.tsx"');
    expect(out).toContain('"typescript"');
  });

  it('injects base href once into already-wrapped preview documents', () => {
    const wrapped = buildPreviewDocument(
      'function App() { return <img src="assets/hero.png" />; }',
      {
        path: 'App.jsx',
      },
    );
    const withBase = buildPreviewDocument(wrapped, {
      path: 'App.jsx',
      baseHref: 'file:///tmp/workspace/',
    });
    const twice = buildPreviewDocument(withBase, {
      path: 'App.jsx',
      baseHref: 'file:///tmp/workspace/',
    });
    expect(withBase.match(/<base /g)).toHaveLength(1);
    expect(twice.match(/<base /g)).toHaveLength(1);
  });

  it('throws for non-renderable workspace paths', () => {
    expect(() => buildPreviewDocument('body {}', { path: 'style.css' })).toThrow(
      /Unsupported preview file type/,
    );
  });
});

describe('artifact source references', () => {
  it('finds strict JSX/TSX source reference comments in placeholder HTML', () => {
    expect(
      findArtifactSourceReference(
        '<!doctype html><html><body><!-- artifact source lives in index.jsx --></body></html>',
      ),
    ).toBe('index.jsx');
    expect(findArtifactSourceReference('<!-- artifact source lives in ./src/App.tsx -->')).toBe(
      'src/App.tsx',
    );
  });

  it('rejects unsafe or non-renderable source reference comments', () => {
    expect(findArtifactSourceReference('<!-- artifact source lives in ../App.jsx -->')).toBeNull();
    expect(
      findArtifactSourceReference('<!-- artifact source lives in /tmp/App.jsx -->'),
    ).toBeNull();
    expect(findArtifactSourceReference('<!-- artifact source lives in app.js -->')).toBeNull();
  });

  it('resolves source references relative to the placeholder HTML path', () => {
    expect(resolveArtifactSourceReferencePath('index.html', 'index.jsx')).toBe('index.jsx');
    expect(resolveArtifactSourceReferencePath('screens/index.html', 'App.tsx')).toBe(
      'screens/App.tsx',
    );
  });
});
