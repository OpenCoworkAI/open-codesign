// when_to_use: Android Material 3 phone shell — gesture or 3-button nav,
// status bar with battery / wifi / signal, dynamic content area. Use for
// Android-specific designs (Material You, gesture nav demos, M3 chips).

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  theme: 'light',
  navStyle: 'gesture',
  scale: 1,
} /*EDITMODE-END*/;

function AndroidPhone({ theme = 'light', navStyle = 'gesture', scale = 1, children }) {
  const dk = theme === 'dark';
  const W = 320;
  const H = 650;
  const bg = dk ? '#1c1b1f' : '#fffbfe';
  const surfaceBg = dk ? '#2b2930' : '#f7f2fa';
  const textColor = dk ? '#e6e1e5' : '#1c1b1f';
  const subColor = dk ? '#938f99' : '#49454f';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <div
      style={{
        display: 'inline-block',
        transform: `scale(${scale})`,
        transformOrigin: 'top center',
      }}
    >
      <div
        style={{
          width: W,
          height: H,
          background: dk
            ? 'linear-gradient(160deg,#3a3840 0%,#2b2930 60%,#1c1b1f 100%)'
            : 'linear-gradient(160deg,#f0edf3 0%,#e8e3ee 100%)',
          borderRadius: 32,
          boxShadow: dk
            ? '0 0 0 1px #4a4852, inset 0 1px 0 rgba(255,255,255,.05), 0 32px 80px rgba(0,0,0,.7)'
            : '0 0 0 1px #cac4d0, inset 0 1px 0 rgba(255,255,255,.6), 0 32px 80px rgba(0,0,0,.18)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -4,
            top: 160,
            width: 5,
            height: 50,
            borderRadius: '0 3px 3px 0',
            background: dk ? '#4a4852' : '#cac4d0',
            boxShadow: '2px 0 4px rgba(0,0,0,.2)',
          }}
        />
        {[80, 130].map((top, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: -4,
              top,
              width: 5,
              height: 38,
              borderRadius: '3px 0 0 3px',
              background: dk ? '#4a4852' : '#cac4d0',
              boxShadow: '-2px 0 4px rgba(0,0,0,.2)',
            }}
          />
        ))}

        <div
          style={{
            margin: '10px 10px 0',
            borderRadius: 24,
            background: bg,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 20px 4px',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'Helvetica Neue, sans-serif',
              color: textColor,
            }}
          >
            <span>{timeStr}</span>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: dk ? '#2b2930' : '#e8e3ee',
                boxShadow: `0 0 0 2px ${dk ? '#3a3840' : '#cac4d0'}`,
                margin: '0 auto',
              }}
            />
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <svg width="14" height="10" viewBox="0 0 14 10" fill={textColor}>
                <rect x="0" y="4" width="2" height="6" rx="1" opacity=".4" />
                <rect x="3" y="3" width="2" height="7" rx="1" opacity=".6" />
                <rect x="6" y="1" width="2" height="9" rx="1" opacity=".8" />
                <rect x="9" y="0" width="2" height="10" rx="1" />
              </svg>
              <svg
                width="14"
                height="10"
                viewBox="0 0 14 10"
                fill="none"
                stroke={textColor}
                strokeWidth="1.5"
              >
                <path d="M1 5.5C3 2.5 11 2.5 13 5.5" />
                <path d="M3.5 7C5 5.2 9 5.2 10.5 7" />
                <circle cx="7" cy="9" r="1" fill={textColor} />
              </svg>
              <div
                style={{
                  width: 22,
                  height: 11,
                  borderRadius: 3,
                  border: `1.5px solid ${textColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '1px 2px',
                  gap: 1,
                  position: 'relative',
                }}
              >
                <div
                  style={{ width: '75%', height: '100%', background: textColor, borderRadius: 1 }}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              padding: '8px 0',
              color: textColor,
              fontFamily: 'Helvetica Neue, sans-serif',
              overflowY: 'auto',
            }}
          >
            {children || (
              <AndroidDefaultContent
                dk={dk}
                surfaceBg={surfaceBg}
                textColor={textColor}
                subColor={subColor}
              />
            )}
          </div>

          {navStyle === 'gesture' ? (
            <div style={{ padding: '8px 0 14px', display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  width: 120,
                  height: 4,
                  background: dk ? '#e6e1e5' : '#1c1b1f',
                  borderRadius: 2,
                  opacity: 0.5,
                }}
              />
            </div>
          ) : (
            <div
              style={{
                padding: '10px 0 14px',
                display: 'flex',
                justifyContent: 'space-around',
                alignItems: 'center',
              }}
            >
              {['◁', '○', '□'].map((icon, i) => (
                <div
                  key={i}
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: dk ? '#e6e1e5' : '#1c1b1f',
                    opacity: 0.7,
                    fontSize: i === 1 ? 18 : 14,
                    cursor: 'pointer',
                  }}
                >
                  {icon}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ height: 10 }} />
      </div>
    </div>
  );
}

function AndroidDefaultContent({ dk, surfaceBg, textColor, subColor }) {
  const M3purple = '#6750a4';
  const M3purpleLight = '#eaddff';
  return (
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 400, color: textColor, marginTop: 4 }}>
        Good morning
      </div>
      <div style={{ background: surfaceBg, borderRadius: 20, padding: 16 }}>
        <div style={{ fontSize: 11, color: subColor, marginBottom: 4 }}>Weather</div>
        <div style={{ fontSize: 32, fontWeight: 300, color: textColor }}>22°</div>
        <div style={{ fontSize: 12, color: subColor }}>Mostly sunny · Low 15°</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['Messages', 'Maps', 'Calendar'].map((l) => (
          <div
            key={l}
            style={{
              padding: '8px 16px',
              borderRadius: 20,
              background: M3purpleLight,
              color: M3purple,
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {l}
          </div>
        ))}
      </div>
      {['Design review at 14:00', '3 unread messages', 'Package arriving today'].map((item, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            background: surfaceBg,
            borderRadius: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: M3purpleLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            {['📅', '💬', '📦'][i]}
          </div>
          <div>
            <div style={{ fontSize: 13, color: textColor }}>{item}</div>
            <div style={{ fontSize: 11, color: subColor }}>
              {['Today', 'Just now', 'Estimated 3–5pm'][i]}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { AndroidPhone, AndroidDefaultContent });

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#e7e0ec',
        padding: 32,
      }}
    >
      <AndroidPhone
        theme={TWEAK_DEFAULTS.theme}
        navStyle={TWEAK_DEFAULTS.navStyle}
        scale={TWEAK_DEFAULTS.scale}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
