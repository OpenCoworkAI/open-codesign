const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  current: 1,
} /*EDITMODE-END*/;

const STEPS = [
  { label: 'Account', hint: 'Create your login' },
  { label: 'Workspace', hint: 'Pick a name' },
  { label: 'Invite team', hint: 'Optional' },
];

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#f8fafc',
        padding: 48,
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          maxWidth: 720,
          margin: '0 auto',
        }}
      >
        {STEPS.map((s, i) => {
          const done = i < TWEAK_DEFAULTS.current;
          const active = i === TWEAK_DEFAULTS.current;
          return (
            <div
              key={s.label}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: done || active ? TWEAK_DEFAULTS.accent : '#e2e8f0',
                  color: done || active ? '#fff' : '#94a3b8',
                  fontWeight: 600,
                  zIndex: 2,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: active ? '#0f172a' : '#475569',
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{s.hint}</div>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 18,
                    left: '50%',
                    right: '-50%',
                    height: 2,
                    background: done ? TWEAK_DEFAULTS.accent : '#e2e8f0',
                    zIndex: 1,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
