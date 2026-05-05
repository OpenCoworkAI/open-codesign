const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "bezelColor": "#1c1c1e",
  "screenBg": "#000000",
  "accentColor": "#0a84ff",
  "screenTitle": "Mobile flow",
  "screenBody": "Primary screen content for the brief.",
  "actionLabel": "Primary action"
}/*EDITMODE-END*/;

function _App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0e0e10',
        padding: 32,
      }}
    >
      <div
        style={{
          width: 402,
          height: 874,
          borderRadius: 64,
          padding: 12,
          background: TWEAK_DEFAULTS.bezelColor,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 0 0 2px #2a2a2c',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 52,
            background: TWEAK_DEFAULTS.screenBg,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 124,
              height: 36,
              borderRadius: 999,
              background: '#000',
              border: '1px solid #1a1a1c',
              zIndex: 5,
            }}
          />
          <div
            style={{
              padding: '64px 24px 24px',
              color: '#fff',
              fontFamily: '-apple-system, "SF Pro", system-ui',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h1 style={{ fontSize: 34, fontWeight: 700, margin: 0 }}>
              {TWEAK_DEFAULTS.screenTitle}
            </h1>
            <p style={{ opacity: 0.7, margin: 0 }}>{TWEAK_DEFAULTS.screenBody}</p>
            <div
              style={{
                marginTop: 'auto',
                padding: 16,
                borderRadius: 16,
                background: TWEAK_DEFAULTS.accentColor,
                textAlign: 'center',
                fontWeight: 600,
              }}
            >
              {TWEAK_DEFAULTS.actionLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
