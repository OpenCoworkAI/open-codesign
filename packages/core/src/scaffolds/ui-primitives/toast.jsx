const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#10b981',
  position: 'top-right',
} /*EDITMODE-END*/;

const STARTER_TOASTS = [
  { id: 't1', kind: 'success', title: 'Saved', message: 'Your changes have been saved.' },
  { id: 't2', kind: 'info', title: 'Sync', message: 'Synced 3 files just now.' },
  { id: 't3', kind: 'error', title: 'Failed', message: 'Could not reach the server.' },
];

const KIND_STYLES = {
  success: { bar: '#10b981', icon: '✓' },
  info: { bar: '#3b82f6', icon: 'ℹ' },
  error: { bar: '#ef4444', icon: '✕' },
};

function App() {
  const { useState } = React;
  const [toasts, setToasts] = useState(STARTER_TOASTS);
  const positionStyle = {
    'top-right': { top: 24, right: 24 },
    'top-left': { top: 24, left: 24 },
    'bottom-right': { bottom: 24, right: 24 },
    'bottom-left': { bottom: 24, left: 24 },
  }[TWEAK_DEFAULTS.position] || { top: 24, right: 24 };

  return (
    <div
      style={{
        minHeight: '100%',
        background: '#0f172a',
        position: 'relative',
        fontFamily: 'system-ui',
        padding: 32,
      }}
    >
      <button
        type="button"
        onClick={() =>
          setToasts((t) => [
            ...t,
            {
              id: `n${Date.now()}`,
              kind: 'success',
              title: 'New toast',
              message: 'Triggered now.',
            },
          ])
        }
        style={{
          padding: '10px 16px',
          background: TWEAK_DEFAULTS.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Trigger toast
      </button>
      <div
        style={{
          position: 'fixed',
          ...positionStyle,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          zIndex: 100,
        }}
      >
        {toasts.map((t) => {
          const s = KIND_STYLES[t.kind];
          return (
            <div
              key={t.id}
              style={{
                background: '#1e293b',
                color: '#f1f5f9',
                padding: '12px 14px',
                borderRadius: 10,
                minWidth: 280,
                display: 'flex',
                gap: 12,
                boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
                borderLeft: `3px solid ${s.bar}`,
              }}
            >
              <div style={{ color: s.bar, fontSize: 18, lineHeight: 1 }}>{s.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
                <div style={{ fontSize: 13, opacity: 0.75 }}>{t.message}</div>
              </div>
              <button
                type="button"
                onClick={() => setToasts((arr) => arr.filter((x) => x.id !== t.id))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  opacity: 0.5,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
