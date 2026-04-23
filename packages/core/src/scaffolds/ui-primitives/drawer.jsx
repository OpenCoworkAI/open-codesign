const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  bg: '#ffffff',
  accent: '#0f172a',
} /*EDITMODE-END*/;

function App() {
  const { useState } = React;
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#e2e8f0',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'system-ui',
      }}
    >
      <div style={{ padding: 32 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: '10px 16px',
            background: TWEAK_DEFAULTS.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Open drawer
        </button>
      </div>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxHeight: '80%',
              background: TWEAK_DEFAULTS.bg,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: '12px 24px 24px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.2)',
              transform: 'translateY(0)',
              transition: 'transform 220ms ease',
            }}
          >
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: '#cbd5e1',
                margin: '0 auto 16px',
              }}
            />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: TWEAK_DEFAULTS.accent }}>
              Drawer title
            </h2>
            <p style={{ color: '#475569', marginTop: 8 }}>
              Drag the handle or tap the backdrop to dismiss. Replace this content with the brief.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: TWEAK_DEFAULTS.accent,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#f1f5f9',
                  color: TWEAK_DEFAULTS.accent,
                  border: 'none',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
