const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#007acc',
  bg: '#1e1e1e',
  sidebarBg: '#252526',
} /*EDITMODE-END*/;

const FILES = [
  {
    name: 'src',
    children: [{ name: 'app.tsx', open: true }, { name: 'main.ts' }, { name: 'router.ts' }],
  },
  { name: 'package.json' },
  { name: 'tsconfig.json' },
  { name: 'README.md' },
];

const CODE = `import { createRoot } from 'react-dom/client';
import { App } from './app';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);`;

function FileNode({ node, depth }) {
  return (
    <div>
      <div
        style={{
          padding: '3px 8px',
          paddingLeft: 8 + depth * 14,
          color: node.open ? '#fff' : '#cccccc',
          background: node.open ? '#37373d' : 'transparent',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {node.children ? '▾ ' : '  '}
        {node.name}
      </div>
      {node.children?.map((c) => (
        <FileNode key={c.name} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#0e0e10',
        padding: 24,
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          display: 'grid',
          gridTemplateRows: '32px 1fr',
        }}
      >
        <div
          style={{
            background: '#3c3c3c',
            color: '#cccccc',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            fontSize: 12,
            gap: 16,
          }}
        >
          <span>File</span>
          <span>Edit</span>
          <span>Selection</span>
          <span>View</span>
          <span>Run</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 540 }}>
          <aside
            style={{ background: TWEAK_DEFAULTS.sidebarBg, color: '#cccccc', padding: '12px 0' }}
          >
            <div style={{ padding: '0 12px', fontSize: 11, letterSpacing: 1, opacity: 0.6 }}>
              EXPLORER
            </div>
            <div style={{ marginTop: 8, fontFamily: '"SF Mono", Menlo, monospace' }}>
              {FILES.map((n) => (
                <FileNode key={n.name} node={n} depth={0} />
              ))}
            </div>
          </aside>
          <section
            style={{
              background: TWEAK_DEFAULTS.bg,
              color: '#d4d4d4',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                background: '#2d2d2d',
                borderBottom: `2px solid ${TWEAK_DEFAULTS.accent}`,
              }}
            >
              <div style={{ padding: '8px 16px', background: TWEAK_DEFAULTS.bg, fontSize: 13 }}>
                app.tsx
              </div>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 20,
                fontFamily: '"SF Mono", Menlo, monospace',
                fontSize: 13,
                lineHeight: 1.6,
                flex: 1,
              }}
            >
              {CODE}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
