const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  bezelColor: '#1a1a1c',
  glassTint: 'rgba(120, 140, 200, 0.18)',
} /*EDITMODE-END*/;

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 30% 20%, #2a1a3a, #050510)',
        padding: 32,
      }}
    >
      <div
        style={{
          width: 880,
          height: 420,
          borderRadius: '50%/55%',
          background: TWEAK_DEFAULTS.bezelColor,
          padding: 24,
          boxShadow: '0 40px 90px rgba(0,0,0,0.7), inset 0 0 0 6px #2a2a2c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 24,
            borderRadius: '50%/55%',
            background: `linear-gradient(135deg, ${TWEAK_DEFAULTS.glassTint}, rgba(0,0,0,0.4))`,
            backdropFilter: 'blur(20px)',
          }}
        />
        <div
          style={{
            position: 'relative',
            color: '#fff',
            padding: '0 64px',
            fontFamily: '-apple-system, "SF Pro", system-ui',
            zIndex: 2,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.6 }}>VISION PRO</div>
          <div style={{ fontSize: 32, fontWeight: 600, marginTop: 8 }}>Spatial canvas</div>
          <div style={{ opacity: 0.7, marginTop: 8, maxWidth: 320 }}>
            Place windows in the user's environment for the brief.
          </div>
        </div>
        <div
          style={{
            position: 'relative',
            width: 280,
            height: 280,
            borderRadius: 24,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.18)',
            backdropFilter: 'blur(30px)',
            marginRight: 64,
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
}
