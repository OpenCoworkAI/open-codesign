// when_to_use: Glassmorphism / liquid-glass surfaces (iOS 26 / visionOS feel).
// Three variants: now-playing card, settings panel with toggle rows, and
// notification stack. Pair with a vivid gradient background — the blur is
// what sells it. Use sparingly; glass on flat backgrounds looks muddy.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  tint: 'rgba(255,255,255,0.42)',
  border: 'rgba(255,255,255,0.55)',
  ink: '#1a1a1a',
  muted: '#3a3a3a',
  blurPx: 28,
  gradient: 'linear-gradient(135deg, #ff7e5f 0%, #feb47b 45%, #86a8e7 100%)',
} /*EDITMODE-END*/;

const SANS = "'DM Sans', system-ui, sans-serif";
const SERIF = "'Fraunces', 'DM Serif Display', Georgia, serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const NUM = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: "'tnum'",
  fontStyle: 'normal',
};

function GlassCard({ children, style, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <div
      style={{
        background: t.tint,
        backdropFilter: `blur(${t.blurPx}px) saturate(180%)`,
        WebkitBackdropFilter: `blur(${t.blurPx}px) saturate(180%)`,
        border: `1px solid ${t.border}`,
        borderRadius: 24,
        padding: 24,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4)',
        color: t.ink,
        fontFamily: SANS,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function GlassNowPlaying({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const [playing, setPlaying] = React.useState(true);
  return (
    <GlassCard tokens={tokens} style={{ width: 340 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: 'linear-gradient(135deg,#fbbf24,#f97316)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: t.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Now playing
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2, fontFamily: SERIF }}>
            Dawn Chorus
          </div>
          <div style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>
            Hania Rani · Inner Symphonies
          </div>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: 'rgba(0,0,0,0.12)',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: '38%',
              background: t.ink,
              borderRadius: 2,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: t.muted,
            marginTop: 6,
            fontFamily: MONO,
            ...NUM,
          }}
        >
          <span>2:08</span>
          <span>5:32</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 28,
          marginTop: 16,
          fontSize: 22,
          color: t.ink,
        }}
      >
        <button
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            fontSize: 'inherit',
          }}
        >
          ⏮
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          style={{
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            border: 'none',
            width: 44,
            height: 44,
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            fontSize: 'inherit',
          }}
        >
          ⏭
        </button>
      </div>
    </GlassCard>
  );
}

function GlassSettings({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const rows = [
    { label: 'Notifications', value: 'On', toggle: true },
    { label: 'Focus mode', value: 'Until 18:00', toggle: true },
    { label: 'Sound effects', value: 'Off', toggle: false },
    { label: 'Haptics', value: 'On', toggle: true },
  ];
  return (
    <GlassCard tokens={tokens} style={{ width: 340, padding: 0 }}>
      <div style={{ padding: '20px 24px 12px' }}>
        <div
          style={{
            fontSize: 11,
            color: t.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          Settings
        </div>
        <div style={{ fontSize: 22, fontFamily: SERIF, marginTop: 4 }}>Quick controls</div>
      </div>
      {rows.map((r, _i) => (
        <div
          key={r.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 24px',
            borderTop: '1px solid rgba(255,255,255,0.35)',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 12, color: t.muted, marginTop: 1 }}>{r.value}</div>
          </div>
          <div
            style={{
              width: 42,
              height: 24,
              borderRadius: 14,
              background: r.toggle ? 'rgba(52,199,89,0.9)' : 'rgba(0,0,0,0.18)',
              position: 'relative',
              transition: 'background 200ms',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 2,
                left: r.toggle ? 20 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                transition: 'left 200ms',
              }}
            />
          </div>
        </div>
      ))}
    </GlassCard>
  );
}

function GlassNotifications({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const items = [
    {
      app: 'Messages',
      from: 'Jamie',
      preview: 'Want to grab coffee tomorrow?',
      time: '2m',
      icon: '💬',
      color: '#22c55e',
    },
    {
      app: 'Calendar',
      from: 'Design review',
      preview: 'Starting in 15 minutes · Room 4B',
      time: '14m',
      icon: '📅',
      color: '#ef4444',
    },
    {
      app: 'Mail',
      from: 'Stripe',
      preview: 'Payment of $2,418.00 received',
      time: '1h',
      icon: '✉️',
      color: '#3b82f6',
    },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 340 }}>
      {items.map((n, i) => (
        <GlassCard
          key={i}
          tokens={tokens}
          style={{
            padding: '12px 16px',
            transform: `translateY(${i * 0}px) scale(${1 - i * 0.015})`,
            opacity: 1 - i * 0.05,
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: n.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              {n.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{n.app}</div>
                <div style={{ fontSize: 11, color: t.muted, fontFamily: MONO, ...NUM }}>
                  {n.time}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{n.from}</div>
              <div
                style={{
                  fontSize: 12,
                  color: t.muted,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {n.preview}
              </div>
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

Object.assign(window, { GlassCard, GlassNowPlaying, GlassSettings, GlassNotifications });

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: TWEAK_DEFAULTS.gradient,
        padding: 48,
        display: 'flex',
        gap: 24,
        flexWrap: 'wrap',
        fontFamily: SANS,
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <GlassNowPlaying />
      <GlassSettings />
      <GlassNotifications />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
