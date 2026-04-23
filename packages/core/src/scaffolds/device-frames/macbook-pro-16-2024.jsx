const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  bezelColor: '#2a2a2d',
  screenBg: '#0b1020',
  accentColor: '#a78bfa',
} /*EDITMODE-END*/;

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#101013',
        padding: 32,
      }}
    >
      <div style={{ width: 1100 }}>
        <div
          style={{
            width: '100%',
            height: 700,
            borderRadius: 24,
            padding: 18,
            background: TWEAK_DEFAULTS.bezelColor,
            boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 220,
              height: 26,
              background: '#000',
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
              zIndex: 5,
            }}
          />
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 14,
              background: TWEAK_DEFAULTS.screenBg,
              overflow: 'hidden',
              padding: 32,
              color: '#e5e7eb',
              fontFamily: '-apple-system, "SF Pro", system-ui',
            }}
          >
            <h1 style={{ fontSize: 48, fontWeight: 700, marginTop: 60 }}>MacBook Pro 16"</h1>
            <p style={{ opacity: 0.7, maxWidth: 600 }}>
              Replace this with the desktop layout for the user's brief.
            </p>
            <button
              type="button"
              style={{
                marginTop: 24,
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: TWEAK_DEFAULTS.accentColor,
                color: '#0b1020',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Primary action
            </button>
          </div>
        </div>
        <div
          style={{
            margin: '0 auto',
            width: '105%',
            height: 18,
            marginLeft: '-2.5%',
            background: 'linear-gradient(180deg, #3a3a3d, #1a1a1c)',
            borderBottomLeftRadius: 24,
            borderBottomRightRadius: 24,
          }}
        />
      </div>
    </div>
  );
}
