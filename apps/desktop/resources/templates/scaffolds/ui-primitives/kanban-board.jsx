const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#3b82f6',
} /*EDITMODE-END*/;

const COLUMNS = [
  {
    id: 'todo',
    title: 'To do',
    cards: [
      { id: 'c1', title: 'Write spec', tag: 'Design', tagColor: '#a78bfa' },
      { id: 'c2', title: 'Run user interviews', tag: 'Research', tagColor: '#34d399' },
    ],
  },
  {
    id: 'doing',
    title: 'In progress',
    cards: [{ id: 'c3', title: 'Build prototype', tag: 'Eng', tagColor: '#60a5fa' }],
  },
  {
    id: 'done',
    title: 'Done',
    cards: [
      { id: 'c4', title: 'Kickoff meeting', tag: 'Ops', tagColor: '#f472b6' },
      { id: 'c5', title: 'Set up repo', tag: 'Eng', tagColor: '#60a5fa' },
    ],
  },
];

function _App() {
  const { useState } = React;
  const [board, setBoard] = useState(COLUMNS);
  const [drag, setDrag] = useState(null);

  function moveCard(targetCol) {
    if (!drag) return;
    setBoard((b) => {
      const next = b.map((c) => ({ ...c, cards: c.cards.filter((k) => k.id !== drag.id) }));
      const target = next.find((c) => c.id === targetCol);
      target.cards.push(drag.card);
      return next;
    });
    setDrag(null);
  }

  return (
    <div
      style={{
        minHeight: '100%',
        background: '#f4f4f7',
        padding: 32,
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginBottom: 20 }}>Roadmap</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {board.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => moveCard(col.id)}
            style={{
              background: '#eceff5',
              borderRadius: 12,
              padding: 12,
              minHeight: 360,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 8px 12px',
                color: '#374151',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <span>{col.title}</span>
              <span style={{ opacity: 0.5 }}>{col.cards.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.cards.map((card) => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={() => setDrag({ id: card.id, card })}
                  style={{
                    background: '#fff',
                    padding: 12,
                    borderRadius: 10,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    cursor: 'grab',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: card.tagColor,
                      color: '#fff',
                      fontSize: 11,
                      marginBottom: 6,
                    }}
                  >
                    {card.tag}
                  </div>
                  <div style={{ color: '#111827', fontSize: 14 }}>{card.title}</div>
                </div>
              ))}
              <button
                type="button"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: TWEAK_DEFAULTS.accent,
                  textAlign: 'left',
                  padding: 8,
                  cursor: 'pointer',
                }}
              >
                + Add card
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
