// when_to_use: macOS Safari window — traffic-light buttons, tab strip,
// URL bar with back/forward and share, light or dark chrome. Use for
// desktop web app mockups or marketing screenshots framed in browser chrome.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "url": "codesign.local",
  "width": 860,
  "height": 580
}/*EDITMODE-END*/;

function MacOSSafari({
  url = 'codesign.local',
  tabs = null,
  theme = 'light',
  scale = 1,
  width = 860,
  height = 580,
  children,
}) {
  const [activeTab, setActiveTab] = React.useState(0);
  const [urlVal, setUrlVal] = React.useState(url);
  const dk = theme === 'dark';
  const defaultTabs = tabs || [
    { title: 'Brief', url: url, active: true },
    { title: 'Design', url: 'codesign.local/design' },
    { title: 'Preview', url: 'codesign.local/preview' },
  ];

  const chromeBg = dk ? '#3a3a3c' : 'linear-gradient(180deg,#f6f6f8 0%,#ebebed 100%)';
  const tabActiveBg = dk ? '#1c1c1e' : '#fff';
  const borderColor = dk ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.12)';
  const textColor = dk ? '#f5f5f7' : '#1d1d1f';
  const subColor = dk ? '#888' : '#666';
  const urlBarBg = dk ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  const contentBg = dk ? '#1c1c1e' : '#fff';

  return (
    <div
      style={{ display: 'inline-block', transform: `scale(${scale})`, transformOrigin: 'top left' }}
    >
      <div
        style={{
          width,
          height,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: dk
            ? '0 0 0 1px rgba(255,255,255,.12), 0 40px 100px rgba(0,0,0,.8), 0 0 0 0.5px rgba(0,0,0,.9)'
            : '0 0 0 1px rgba(0,0,0,.15), 0 40px 100px rgba(0,0,0,.25), 0 2px 4px rgba(0,0,0,.08)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Helvetica Neue, sans-serif',
        }}
      >
        <div style={{ background: chromeBg, borderBottom: `1px solid ${borderColor}` }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 38, paddingLeft: 12 }}>
            <div style={{ display: 'flex', gap: 7, marginRight: 16, flexShrink: 0 }}>
              {[
                ['#ff5f57', '#e0443e'],
                ['#febc2e', '#d4a017'],
                ['#28c840', '#1aab29'],
              ].map(([color, hover], i) => (
                <div
                  key={i}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 0 0.5px ${hover}`,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 0,
                flex: 1,
                overflowX: 'auto',
                height: '100%',
              }}
            >
              {defaultTabs.map((tab, i) => (
                <div
                  key={i}
                  onClick={() => setActiveTab(i)}
                  style={{
                    padding: '0 28px 0 12px',
                    height: 30,
                    lineHeight: '30px',
                    fontSize: 12,
                    color: i === activeTab ? textColor : subColor,
                    background: i === activeTab ? tabActiveBg : 'transparent',
                    borderRadius: '8px 8px 0 0',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    border: i === activeTab ? `1px solid ${borderColor}` : '1px solid transparent',
                    borderBottom: 'none',
                    position: 'relative',
                    transition: 'background .15s',
                    flexShrink: 0,
                  }}
                >
                  {tab.title}
                  <span
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 10,
                      color: subColor,
                      opacity: 0.7,
                    }}
                  >
                    ✕
                  </span>
                </div>
              ))}
              <div
                style={{
                  padding: '0 10px',
                  cursor: 'pointer',
                  color: subColor,
                  fontSize: 18,
                  lineHeight: '30px',
                  opacity: 0.7,
                }}
              >
                +
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 8px' }}>
            <div style={{ display: 'flex', gap: 0 }}>
              {['‹', '›'].map((arr, i) => (
                <button
                  key={i}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: i === 0 ? textColor : subColor,
                    fontSize: 20,
                    padding: '0 6px',
                    opacity: i === 0 ? 1 : 0.4,
                  }}
                >
                  {arr}
                </button>
              ))}
            </div>
            <div
              style={{
                flex: 1,
                height: 28,
                background: urlBarBg,
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 10px',
              }}
            >
              <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
                <path
                  d="M5.5 1C3 1 1 3 1 5.5S3 10 5.5 10 10 8 10 5.5 8 1 5.5 1Z"
                  stroke={subColor}
                  strokeWidth="1.2"
                />
                <path d="M5.5 10v2" stroke={subColor} strokeWidth="1.2" />
                <path d="M3 12h5" stroke={subColor} strokeWidth="1.2" />
              </svg>
              <input
                value={urlVal}
                onChange={(e) => setUrlVal(e.target.value)}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: 12,
                  color: textColor,
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <button
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: subColor,
                fontSize: 15,
                padding: '0 4px',
              }}
            >
              ⬆
            </button>
          </div>
        </div>

        <div style={{ flex: 1, background: contentBg, overflow: 'hidden' }}>
          {children || <SafariDefaultContent dk={dk} url={defaultTabs[activeTab]?.url} />}
        </div>
      </div>
    </div>
  );
}

function SafariDefaultContent({ dk, url }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: dk ? '#1c1c1e' : '#f5f5f7',
        color: dk ? '#888' : '#999',
        fontFamily: 'Helvetica Neue, sans-serif',
        fontSize: 13,
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 36, opacity: 0.3 }}>🌐</div>
      <div style={{ opacity: 0.5 }}>{url}</div>
    </div>
  );
}

Object.assign(window, { MacOSSafari, SafariDefaultContent });

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: TWEAK_DEFAULTS.theme === 'dark' ? '#0a0a0a' : '#e9e9ee',
        padding: 32,
      }}
    >
      <MacOSSafari
        theme={TWEAK_DEFAULTS.theme}
        url={TWEAK_DEFAULTS.url}
        width={TWEAK_DEFAULTS.width}
        height={TWEAK_DEFAULTS.height}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
