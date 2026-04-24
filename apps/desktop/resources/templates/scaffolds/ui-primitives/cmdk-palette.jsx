const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
} /*EDITMODE-END*/;

const ITEMS = [
  { id: 'new', icon: '＋', label: 'Create new design', shortcut: '⌘N' },
  { id: 'open', icon: '📂', label: 'Open recent', shortcut: '⌘O' },
  { id: 'export', icon: '⇪', label: 'Export as PDF', shortcut: '⌘E' },
  { id: 'theme', icon: '◐', label: 'Toggle theme', shortcut: '⌘⇧T' },
  { id: 'help', icon: '?', label: 'Help & shortcuts', shortcut: '⌘/' },
];

function _App() {
  const { useState } = React;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const filtered = ITEMS.filter((it) => it.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div
      style={{
        minHeight: '100%',
        background: 'rgba(15,15,20,0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 120,
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          width: 560,
          background: '#1c1c22',
          borderRadius: 14,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          color: '#e5e7eb',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder="Type a command or search…"
          style={{
            width: '100%',
            padding: '16px 20px',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            fontSize: 16,
            outline: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        />
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>No results</div>
          )}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 8,
                background: i === active ? TWEAK_DEFAULTS.accent : 'transparent',
                color: i === active ? '#fff' : 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 20 }}>{it.icon}</span>
              <span style={{ flex: 1 }}>{it.label}</span>
              <span style={{ opacity: 0.6, fontSize: 12 }}>{it.shortcut}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
