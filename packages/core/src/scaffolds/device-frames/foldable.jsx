const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  bezelColor: '#0f0f12',
  screenBg: '#1a1a1f',
  state: 'open',
} /*EDITMODE-END*/;

function Panel({ children, width }) {
  return (
    <div
      style={{
        width,
        height: 620,
        borderRadius: 18,
        padding: 8,
        background: TWEAK_DEFAULTS.bezelColor,
        boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          background: TWEAK_DEFAULTS.screenBg,
          color: '#e5e7eb',
          padding: 20,
          fontFamily: 'system-ui',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function App() {
  const open = TWEAK_DEFAULTS.state === 'open';
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0c',
        padding: 32,
        gap: open ? 6 : 0,
      }}
    >
      <Panel width={open ? 280 : 0}>
        <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: 2 }}>COVER</div>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Quick view</h2>
        <p style={{ opacity: 0.7, fontSize: 13 }}>Notifications and widgets.</p>
      </Panel>
      <Panel width={560}>
        <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: 2 }}>MAIN</div>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>Foldable layout</h1>
        <p style={{ opacity: 0.7 }}>
          Toggle <code>state</code> between <code>open</code> and <code>closed</code> to preview
          both modes.
        </p>
      </Panel>
    </div>
  );
}
