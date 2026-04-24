// when_to_use: Apple Watch app design — round-square chrome with digital
// crown, side button, orange Action button, and band caps. Adapt the inner
// face for the user's brief; use `dk` to flip dark / light.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  theme: 'dark',
  accentColor: '#ff375f',
  scale: 1,
} /*EDITMODE-END*/;

function AppleWatchUltra({ theme = 'dark', scale = 1, children }) {
  const dk = theme === 'dark';
  const W = 300;
  const H = 375;
  const s = {
    shell: {
      position: 'relative',
      width: W,
      height: H,
      background: dk
        ? 'linear-gradient(145deg,#4a4a4e 0%,#3a3a3c 50%,#2c2c2e 100%)'
        : 'linear-gradient(145deg,#e8e8ed 0%,#d1d1d6 50%,#c7c7cc 100%)',
      borderRadius: 40,
      boxShadow: dk
        ? '0 0 0 1.5px #555, inset 0 1px 0 rgba(255,255,255,.12), 0 28px 80px rgba(0,0,0,.7)'
        : '0 0 0 1.5px #b0b0b5, inset 0 1px 0 rgba(255,255,255,.5), 0 28px 80px rgba(0,0,0,.22)',
      display: 'inline-block',
      flexShrink: 0,
    },
    screen: {
      position: 'absolute',
      top: 22,
      left: 18,
      right: 18,
      bottom: 22,
      background: dk ? '#000' : '#1c1c1e',
      borderRadius: 28,
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    bandTop: {
      position: 'absolute',
      top: -56,
      left: 34,
      right: 34,
      height: 62,
      background: dk
        ? 'linear-gradient(180deg,#1c1c1e 0%,#2c2c2e 100%)'
        : 'linear-gradient(180deg,#c7c7cc 0%,#d1d1d6 100%)',
      borderRadius: '10px 10px 0 0',
      boxShadow: dk ? '0 -2px 8px rgba(0,0,0,.4)' : '0 -2px 8px rgba(0,0,0,.1)',
    },
    bandBottom: {
      position: 'absolute',
      bottom: -56,
      left: 34,
      right: 34,
      height: 62,
      background: dk
        ? 'linear-gradient(0deg,#1c1c1e 0%,#2c2c2e 100%)'
        : 'linear-gradient(0deg,#c7c7cc 0%,#d1d1d6 100%)',
      borderRadius: '0 0 10px 10px',
      boxShadow: dk ? '0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(0,0,0,.1)',
    },
    crown: {
      position: 'absolute',
      right: -9,
      top: 74,
      width: 10,
      height: 54,
      background: dk
        ? 'linear-gradient(90deg,#555 0%,#3a3a3c 100%)'
        : 'linear-gradient(90deg,#d1d1d6 0%,#b0b0b5 100%)',
      borderRadius: '0 5px 5px 0',
      boxShadow: dk ? '3px 0 6px rgba(0,0,0,.5)' : '3px 0 6px rgba(0,0,0,.18)',
    },
    crownRidges: {
      position: 'absolute',
      inset: 0,
      borderRadius: '0 5px 5px 0',
      background: dk
        ? 'repeating-linear-gradient(0deg,transparent,transparent 5px,rgba(255,255,255,.07) 5px,rgba(255,255,255,.07) 6px)'
        : 'repeating-linear-gradient(0deg,transparent,transparent 5px,rgba(0,0,0,.07) 5px,rgba(0,0,0,.07) 6px)',
    },
    sideBtn: {
      position: 'absolute',
      right: -7,
      top: 148,
      width: 8,
      height: 38,
      background: dk
        ? 'linear-gradient(90deg,#555 0%,#3a3a3c 100%)'
        : 'linear-gradient(90deg,#d1d1d6 0%,#b0b0b5 100%)',
      borderRadius: '0 4px 4px 0',
      boxShadow: dk ? '3px 0 5px rgba(0,0,0,.5)' : '3px 0 5px rgba(0,0,0,.15)',
    },
    actionBtn: {
      position: 'absolute',
      left: -9,
      top: 108,
      width: 10,
      height: 44,
      background: 'linear-gradient(90deg,#d04800 0%,#f06000 100%)',
      borderRadius: '5px 0 0 5px',
      boxShadow: '-3px 0 8px rgba(200,80,0,.5)',
    },
  };
  return (
    <div
      style={{
        display: 'inline-block',
        transform: `scale(${scale})`,
        transformOrigin: 'top center',
      }}
    >
      <div style={{ padding: '62px 24px 62px' }}>
        <div style={s.shell}>
          <div style={s.bandTop} />
          <div style={s.bandBottom} />
          <div style={s.crown}>
            <div style={s.crownRidges} />
          </div>
          <div style={s.sideBtn} />
          <div style={s.actionBtn} />
          <div style={s.screen}>
            {children || <WatchDefaultFace dk={dk} accent={TWEAK_DEFAULTS.accentColor} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function WatchDefaultFace({ dk = true, accent = '#ff375f' }) {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  return (
    <div
      style={{
        textAlign: 'center',
        color: '#fff',
        fontFamily: 'Helvetica Neue, sans-serif',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: accent,
          letterSpacing: 2,
          marginBottom: 6,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {now.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
      <div style={{ fontSize: 56, fontWeight: 200, letterSpacing: -2, lineHeight: 1 }}>
        {h}:{m}
      </div>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 12 }}>
        {['❤️ 72', '🔥 480', '⚡ 85%'].map((x) => (
          <div
            key={x}
            style={{
              fontSize: 9,
              background: 'rgba(255,255,255,.1)',
              padding: '3px 7px',
              borderRadius: 8,
            }}
          >
            {x}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            width: 180,
            height: 3,
            background: 'rgba(255,255,255,.12)',
            borderRadius: 2,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              width: '62%',
              height: '100%',
              background: 'linear-gradient(90deg,#30d158,#34c759)',
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AppleWatchUltra, WatchDefaultFace });

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        padding: 32,
      }}
    >
      <AppleWatchUltra theme={TWEAK_DEFAULTS.theme} scale={TWEAK_DEFAULTS.scale}>
        <WatchDefaultFace
          dk={TWEAK_DEFAULTS.theme === 'dark'}
          accent={TWEAK_DEFAULTS.accentColor}
        />
      </AppleWatchUltra>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
