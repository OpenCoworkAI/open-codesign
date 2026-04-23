const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
} /*EDITMODE-END*/;

const STATES = [
  {
    icon: '🔍',
    title: 'No results found',
    body: 'Try adjusting your filters or search terms.',
    cta: 'Reset filters',
  },
  {
    icon: '✉️',
    title: 'Inbox zero',
    body: 'You have caught up. New mail will appear here.',
    cta: 'Compose',
  },
  {
    icon: '📊',
    title: 'No data yet',
    body: 'Connect a source to start charting trends.',
    cta: 'Add source',
  },
  {
    icon: '🗂',
    title: 'Board is empty',
    body: 'Drag cards from the backlog or create a new task.',
    cta: 'New task',
  },
  {
    icon: '⚠️',
    title: 'Something went wrong',
    body: 'We could not load this view. Try again in a moment.',
    cta: 'Retry',
  },
];

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#f8fafc',
        padding: 32,
        fontFamily: 'system-ui',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
      }}
    >
      {STATES.map((s) => (
        <div
          key={s.title}
          style={{
            background: '#fff',
            border: '1px dashed #cbd5e1',
            borderRadius: 14,
            padding: 28,
            textAlign: 'center',
            color: '#1f2937',
          }}
        >
          <div style={{ fontSize: 38, marginBottom: 12 }}>{s.icon}</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{s.title}</div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>{s.body}</div>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: '8px 14px',
              background: TWEAK_DEFAULTS.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {s.cta}
          </button>
        </div>
      ))}
    </div>
  );
}
