// iPad device frame starter — landscape-ish layout with a sidebar +
// content split. Uses the IOSDevice / IOSNavBar components from the
// pre-loaded ios-frame.jsx runtime.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accentColor: '#0a84ff',
  bgColor: '#ffffff',
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
        padding: 32,
      }}
    >
      <div
        style={{
          width: 1024,
          height: 768,
          borderRadius: 32,
          overflow: 'hidden',
          background: TWEAK_DEFAULTS.bgColor,
          display: 'flex',
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
          fontFamily: '-apple-system, "SF Pro", system-ui',
        }}
      >
        <aside
          style={{
            width: 260,
            background: '#f2f2f7',
            padding: 20,
            borderRight: '1px solid #e5e5ea',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#8a8a8e',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 12,
            }}
          >
            Sidebar
          </div>
          {['Inbox', 'Today', 'Upcoming', 'Anytime'].map((label) => (
            <div
              key={label}
              style={{ padding: '10px 12px', borderRadius: 10, color: '#1d1d1f', fontSize: 15 }}
            >
              {label}
            </div>
          ))}
        </aside>
        <main style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 style={{ fontSize: 34, fontWeight: 700, color: '#1d1d1f' }}>Title</h1>
          <p style={{ fontSize: 17, color: '#6e6e73' }}>Replace with your iPad screen contents.</p>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
