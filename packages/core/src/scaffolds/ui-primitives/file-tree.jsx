const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
} /*EDITMODE-END*/;

const TREE = [
  {
    name: 'src',
    children: [
      { name: 'components', children: [{ name: 'Button.tsx' }, { name: 'Card.tsx' }] },
      { name: 'pages', children: [{ name: 'index.tsx' }, { name: 'about.tsx' }] },
      { name: 'main.ts' },
    ],
  },
  { name: 'package.json' },
  { name: 'tsconfig.json' },
];

function Node({ node, depth }) {
  const { useState } = React;
  const [open, setOpen] = useState(true);
  const isFolder = !!node.children;
  return (
    <div>
      <div
        onClick={() => isFolder && setOpen((v) => !v)}
        style={{
          padding: '4px 8px',
          paddingLeft: 8 + depth * 18,
          fontSize: 13,
          cursor: isFolder ? 'pointer' : 'default',
          color: isFolder ? '#0f172a' : '#475569',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ width: 14, color: TWEAK_DEFAULTS.accent }}>
          {isFolder ? (open ? '▾' : '▸') : ' '}
        </span>
        <span>{isFolder ? '📁' : '📄'}</span>
        <span>{node.name}</span>
      </div>
      {isFolder &&
        open &&
        node.children.map((c) => <Node key={c.name} node={c} depth={depth + 1} />)}
    </div>
  );
}

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#f8fafc',
        padding: 32,
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          maxWidth: 320,
          background: '#fff',
          padding: 12,
          borderRadius: 12,
          boxShadow: '0 6px 18px rgba(15,23,42,0.06)',
        }}
      >
        {TREE.map((n) => (
          <Node key={n.name} node={n} depth={0} />
        ))}
      </div>
    </div>
  );
}
