// when_to_use: Month-view calendar with events. Includes prev/next/today
// navigation, weekday header, day cells with up to 2 inline events + "more"
// indicator, hover tooltips, and a selected-day detail panel. Use when the
// brief asks for "calendar", "schedule", "month view", or "events".

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  todayColor: '#6366f1',
  selectedBg: '#eef2ff',
} /*EDITMODE-END*/;

const EVENTS = [
  { id: 1, date: '2026-04-01', title: 'Q2 Kickoff', color: '#6366f1', time: '09:00' },
  { id: 2, date: '2026-04-03', title: 'Design Review', color: '#0ea5e9', time: '14:00' },
  { id: 3, date: '2026-04-03', title: '1:1 w/ Sarah', color: '#22c55e', time: '16:00' },
  { id: 4, date: '2026-04-07', title: 'Sprint Planning', color: '#f59e0b', time: '10:00' },
  { id: 5, date: '2026-04-10', title: 'User Interviews', color: '#ec4899', time: '13:00' },
  { id: 6, date: '2026-04-14', title: 'Board Presentation', color: '#6366f1', time: '15:00' },
  { id: 7, date: '2026-04-14', title: 'Retrospective', color: '#0ea5e9', time: '17:00' },
  { id: 8, date: '2026-04-17', title: 'Product Demo', color: '#f59e0b', time: '11:00' },
  { id: 9, date: '2026-04-20', title: 'Today — Launch', color: '#ef4444', time: '09:00' },
  { id: 10, date: '2026-04-22', title: 'Investor Call', color: '#8b5cf6', time: '14:30' },
  { id: 11, date: '2026-04-24', title: 'Team Offsite', color: '#22c55e', time: 'All day' },
  { id: 12, date: '2026-04-28', title: 'OKR Review', color: '#6366f1', time: '10:00' },
];

function CalendarComponent() {
  const [current, setCurrent] = React.useState(new Date(2026, 3, 1));
  const [tooltip, setTooltip] = React.useState(null);
  const [selectedDate, setSelectedDate] = React.useState(null);

  const year = current.getFullYear();
  const month = current.getMonth();
  const today = new Date(2026, 3, 20);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const monthLabel = current.toLocaleDateString('en', { month: 'long', year: 'numeric' });
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const eventsForDate = (dateStr) => EVENTS.filter((e) => e.date === dateStr);
  const dateStr = (d) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevMonthDays - i, thisMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, thisMonth: true });
  const rem = 42 - cells.length;
  for (let d = 1; d <= rem; d++) cells.push({ day: d, thisMonth: false });

  const isToday = (d, thisMonth) =>
    thisMonth &&
    d === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();
  const isSelected = (d, thisMonth) => thisMonth && selectedDate === dateStr(d);

  return (
    <div
      style={{
        fontFamily: 'Helvetica Neue, sans-serif',
        background: '#fff',
        borderRadius: 14,
        border: '1px solid #e4e4e7',
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #f4f4f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: '#18181b',
              letterSpacing: -0.3,
            }}
          >
            {monthLabel}
          </h2>
          <button
            onClick={() => {
              setCurrent(new Date(2026, 3, 1));
              setSelectedDate(null);
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #e4e4e7',
              background: '#fafafa',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: '#52525b',
            }}
          >
            Today
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['‹', '›'].map((arr, i) => (
            <button
              key={arr}
              onClick={() => setCurrent(new Date(year, month + (i === 0 ? -1 : 1), 1))}
              style={{
                width: 30,
                height: 30,
                borderRadius: 7,
                border: '1px solid #e4e4e7',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 16,
                color: '#52525b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              {arr}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7,1fr)',
          borderBottom: '1px solid #f4f4f5',
        }}
      >
        {weekdays.map((d) => (
          <div
            key={d}
            style={{
              padding: '8px 0',
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: '#a1a1aa',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', position: 'relative' }}
        data-cal
      >
        {cells.map((cell, idx) => {
          const ds = cell.thisMonth ? dateStr(cell.day) : null;
          const evts = ds ? eventsForDate(ds) : [];
          const today_ = isToday(cell.day, cell.thisMonth);
          const sel = isSelected(cell.day, cell.thisMonth);
          const isWeekend = idx % 7 === 0 || idx % 7 === 6;

          return (
            <div
              key={idx}
              onClick={() => cell.thisMonth && setSelectedDate(sel ? null : ds)}
              style={{
                minHeight: 88,
                padding: '6px 8px',
                borderBottom: '1px solid #f4f4f5',
                borderRight: idx % 7 < 6 ? '1px solid #f4f4f5' : 'none',
                background: sel
                  ? TWEAK_DEFAULTS.selectedBg
                  : isWeekend && cell.thisMonth
                    ? '#fafafa'
                    : '#fff',
                cursor: cell.thisMonth ? 'pointer' : 'default',
                transition: 'background .1s',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: today_ ? TWEAK_DEFAULTS.todayColor : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: today_ ? 700 : sel ? 600 : 400,
                  color: today_
                    ? '#fff'
                    : cell.thisMonth
                      ? sel
                        ? TWEAK_DEFAULTS.accent
                        : '#18181b'
                      : '#d4d4d8',
                  marginBottom: 4,
                }}
              >
                {cell.day}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {evts.slice(0, 2).map((evt) => (
                  <div
                    key={evt.id}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const parent = e.currentTarget.closest('[data-cal]');
                      const parentRect = parent.getBoundingClientRect();
                      setTooltip({
                        event: evt,
                        x: rect.left - parentRect.left,
                        y: rect.bottom - parentRect.top + 6,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: `${evt.color}18`,
                      borderLeft: `2.5px solid ${evt.color}`,
                      fontSize: 10,
                      fontWeight: 500,
                      color: evt.color,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'default',
                    }}
                  >
                    {evt.title}
                  </div>
                ))}
                {evts.length > 2 && (
                  <div style={{ fontSize: 10, color: '#a1a1aa', paddingLeft: 4 }}>
                    +{evts.length - 2} more
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(tooltip.x, 540),
              top: tooltip.y,
              background: '#18181b',
              color: '#fff',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,.18)',
              pointerEvents: 'none',
              minWidth: 160,
              zIndex: 30,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: tooltip.event.color,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              {tooltip.event.title}
            </div>
            <div style={{ color: '#a1a1aa', fontSize: 11 }}>
              {new Date(`${tooltip.event.date}T00:00`).toLocaleDateString('en', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
              {' · '}
              {tooltip.event.time}
            </div>
          </div>
        )}
      </div>

      {selectedDate &&
        (() => {
          const dayEvts = eventsForDate(selectedDate);
          if (!dayEvts.length) return null;
          return (
            <div
              style={{
                borderTop: '1px solid #f4f4f5',
                padding: '16px 20px',
                background: '#fafafa',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#52525b',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {new Date(`${selectedDate}T00:00`).toLocaleDateString('en', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dayEvts.map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      background: '#fff',
                      borderRadius: 8,
                      border: '1px solid #f4f4f5',
                    }}
                  >
                    <div
                      style={{
                        width: 4,
                        height: 36,
                        borderRadius: 2,
                        background: evt.color,
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#18181b' }}>
                        {evt.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>{evt.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

Object.assign(window, { CalendarComponent });

function App() {
  return (
    <div style={{ minHeight: '100vh', padding: 32, background: '#f4f4f5' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <CalendarComponent />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
