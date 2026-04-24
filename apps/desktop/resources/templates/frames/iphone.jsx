// iPhone device frame starter — uses the IOSDevice component pre-loaded
// by the runtime. Adapt the screen contents to the user's brief; keep the
// EDITMODE block at the top so the host can render a tweak panel.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accentColor: '#0a84ff',
  bgColor: '#f5f5f7',
} /*EDITMODE-END*/;

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#e9e9ee',
        padding: 24,
      }}
    >
      <IOSDevice>
        <IOSStatusBar />
        <div
          style={{
            flex: 1,
            padding: 24,
            background: TWEAK_DEFAULTS.bgColor,
            fontFamily: '-apple-system, "SF Pro", system-ui',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h1 style={{ fontSize: 28, fontWeight: 600, color: '#1d1d1f' }}>Title</h1>
          <p style={{ fontSize: 16, color: '#6e6e73' }}>Replace with your screen contents.</p>
          <button
            style={{
              marginTop: 'auto',
              padding: '14px 24px',
              background: TWEAK_DEFAULTS.accentColor,
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              fontSize: 17,
              fontWeight: 500,
            }}
          >
            Continue
          </button>
        </div>
      </IOSDevice>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
