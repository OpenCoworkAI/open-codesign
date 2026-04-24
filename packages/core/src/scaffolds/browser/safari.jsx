const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  url: 'apple.com',
  title: 'Apple',
} /*EDITMODE-END*/;

function _App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#e9eaee',
        padding: 32,
        fontFamily: '-apple-system, "SF Pro", system-ui',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          background: '#fff',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(180deg,#f5f5f7,#e9eaee)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid #d1d1d6',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 8, opacity: 0.55 }}>
            <span>{'<'}</span>
            <span>{'>'}</span>
          </div>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 500 }}>
            <div style={{ opacity: 0.5, fontSize: 11 }}>{TWEAK_DEFAULTS.url}</div>
            <div>{TWEAK_DEFAULTS.title}</div>
          </div>
          <div style={{ width: 80 }} />
        </div>
        <div style={{ minHeight: 520, padding: 40, color: '#1d1d1f' }}>
          <h1 style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>Headline.</h1>
          <p style={{ opacity: 0.7, fontSize: 18 }}>Replace with the brief.</p>
        </div>
      </div>
    </div>
  );
}
