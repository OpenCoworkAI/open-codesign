const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  spaceColor: '#f7c0a3',
  spaceName: 'Work',
} /*EDITMODE-END*/;

function App() {
  const tabs = [
    { name: 'GitHub', favicon: '⌥' },
    { name: 'Notion', favicon: '◾' },
    { name: 'Linear', favicon: '▲' },
    { name: 'Figma', favicon: '◆' },
  ];
  return (
    <div
      style={{
        minHeight: '100%',
        background: `linear-gradient(135deg, ${TWEAK_DEFAULTS.spaceColor}, #f0a0c0)`,
        padding: 24,
        fontFamily: '-apple-system, "SF Pro", system-ui',
        display: 'flex',
        gap: 12,
      }}
    >
      <aside
        style={{
          width: 220,
          color: '#1d1d1f',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            background: 'rgba(255,255,255,0.5)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ⌘T Search or enter URL
        </div>
        <div style={{ fontSize: 11, opacity: 0.6, padding: '8px 4px', letterSpacing: 1 }}>
          {TWEAK_DEFAULTS.spaceName.toUpperCase()}
        </div>
        {tabs.map((t, i) => (
          <div
            key={t.name}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: i === 0 ? 'rgba(255,255,255,0.85)' : 'transparent',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 16, textAlign: 'center' }}>{t.favicon}</span>
            <span>{t.name}</span>
          </div>
        ))}
      </aside>
      <main
        style={{
          flex: 1,
          background: '#fff',
          borderRadius: 12,
          padding: 40,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
      >
        <h1 style={{ fontSize: 36, fontWeight: 700 }}>Page content</h1>
        <p style={{ opacity: 0.7 }}>Replace with the brief.</p>
      </main>
    </div>
  );
}
