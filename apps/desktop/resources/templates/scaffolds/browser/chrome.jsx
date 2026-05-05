const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "url": "codesign.local/workspace",
  "theme": "light",
  "pageTitle": "Workspace overview",
  "pageBody": "Primary page state staged inside Chrome."
}/*EDITMODE-END*/;

function _App() {
  const dark = TWEAK_DEFAULTS.theme === 'dark';
  const chromeBg = dark ? '#202124' : '#dee1e6';
  const tabBg = dark ? '#35363a' : '#ffffff';
  const text = dark ? '#e8eaed' : '#202124';
  return (
    <div
      style={{
        minHeight: '100%',
        background: dark ? '#0e0e10' : '#f1f3f4',
        padding: 32,
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          background: tabBg,
        }}
      >
        <div style={{ background: chromeBg, padding: '8px 12px 0', color: text }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
            <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
              {['Inbox', 'Docs', 'Design'].map((t, i) => (
                <div
                  key={t}
                  style={{
                    padding: '6px 14px',
                    background: i === 0 ? tabBg : 'transparent',
                    borderRadius: '8px 8px 0 0',
                    fontSize: 13,
                    opacity: i === 0 ? 1 : 0.6,
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              background: tabBg,
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
            }}
          >
            <span style={{ opacity: 0.5 }}>{'<'}</span>
            <span style={{ opacity: 0.5 }}>{'>'}</span>
            <span style={{ opacity: 0.5 }}>↻</span>
            <div
              style={{
                flex: 1,
                background: dark ? '#2c2d30' : '#f1f3f4',
                borderRadius: 999,
                padding: '6px 14px',
                fontSize: 13,
              }}
            >
              {TWEAK_DEFAULTS.url}
            </div>
          </div>
        </div>
        <div style={{ minHeight: 480, padding: 32, color: text }}>
          <h1 style={{ fontSize: 36, fontWeight: 700 }}>{TWEAK_DEFAULTS.pageTitle}</h1>
          <p style={{ opacity: 0.7 }}>{TWEAK_DEFAULTS.pageBody}</p>
        </div>
      </div>
    </div>
  );
}
