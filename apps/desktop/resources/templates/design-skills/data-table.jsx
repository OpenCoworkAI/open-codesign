// when_to_use: Admin / dashboard data table. Sortable columns, filter input,
// row selection with bulk actions, pagination, status badges, and inline
// usage bars. Use when the brief asks for "users table", "admin panel",
// "data grid", or "list view".

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  headerBg: '#fafafa',
  selectedBg: '#eef2ff',
} /*EDITMODE-END*/;

const TABLE_DATA = Array.from({ length: 48 }, (_, i) => ({
  id: i + 1,
  name: [
    'Alice Chen',
    'Bob Martinez',
    'Carol White',
    'David Kim',
    'Eva Santos',
    'Frank Liu',
    'Grace Park',
    'Henry Brown',
    'Iris Ng',
    'James Wilson',
  ][i % 10],
  email: `${['alice', 'bob', 'carol', 'david', 'eva', 'frank', 'grace', 'henry', 'iris', 'james'][i % 10]}${Math.floor(i / 10) || ''}@acme.io`,
  role: [
    'Admin',
    'Member',
    'Viewer',
    'Member',
    'Admin',
    'Member',
    'Viewer',
    'Member',
    'Admin',
    'Member',
  ][i % 10],
  status: [
    'Active',
    'Active',
    'Inactive',
    'Active',
    'Active',
    'Pending',
    'Active',
    'Inactive',
    'Active',
    'Active',
  ][i % 10],
  joined: new Date(2024, (i * 3) % 12, ((i * 7) % 28) + 1).toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }),
  usage: (i * 17) % 100,
}));

const COLS = [
  { key: 'name', label: 'Name', sortable: true, width: '20%' },
  { key: 'email', label: 'Email', sortable: true, width: '22%' },
  { key: 'role', label: 'Role', sortable: true, width: '12%' },
  { key: 'status', label: 'Status', sortable: true, width: '12%' },
  { key: 'joined', label: 'Joined', sortable: true, width: '15%' },
  { key: 'usage', label: 'Usage', sortable: true, width: '14%' },
];

function StatusBadge({ status }) {
  const map = {
    Active: ['#dcfce7', '#166534'],
    Inactive: ['#f4f4f5', '#71717a'],
    Pending: ['#fef9c3', '#854d0e'],
  };
  const [bg, color] = map[status] || map.Active;
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: 20,
        background: bg,
        color,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

function UsageBar({ value }) {
  const color = value > 80 ? '#ef4444' : value > 50 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#f4f4f5', borderRadius: 3 }}>
        <div
          style={{
            width: `${value}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
            transition: 'width .3s',
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: '#71717a', width: 28, textAlign: 'right' }}>
        {value}%
      </span>
    </div>
  );
}

function DataTable() {
  const [sortKey, setSortKey] = React.useState('name');
  const [sortDir, setSortDir] = React.useState('asc');
  const [filter, setFilter] = React.useState('');
  const [selected, setSelected] = React.useState(new Set());
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 8;

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const filtered = TABLE_DATA.filter(
    (row) =>
      !filter ||
      Object.values(row).some((v) => String(v).toLowerCase().includes(filter.toLowerCase())),
  );

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageIds = new Set(pageRows.map((r) => r.id));
  const allPageSelected = pageIds.size > 0 && [...pageIds].every((id) => selected.has(id));

  const toggleRow = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allPageSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });

  const SortIcon = ({ col }) => (
    <span style={{ marginLeft: 4, opacity: sortKey === col ? 1 : 0.3, fontSize: 10 }}>
      {sortKey === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  return (
    <div
      style={{
        fontFamily: 'Helvetica Neue, sans-serif',
        background: '#fff',
        borderRadius: 14,
        border: '1px solid #e4e4e7',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #f4f4f5',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
          <svg
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
          >
            <circle cx="5.5" cy="5.5" r="4.5" stroke="#a1a1aa" strokeWidth="1.3" />
            <path d="M9 9l2.5 2.5" stroke="#a1a1aa" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Filter users…"
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              borderRadius: 8,
              border: '1px solid #e4e4e7',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              color: '#18181b',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: TWEAK_DEFAULTS.accent, fontWeight: 600 }}>
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Set())}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Remove
            </button>
          </div>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#a1a1aa' }}>
          {filtered.length} users
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: TWEAK_DEFAULTS.headerBg, borderBottom: '1px solid #f4f4f5' }}>
              <th style={{ padding: '10px 14px', width: 40, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer', accentColor: TWEAK_DEFAULTS.accent }}
                />
              </th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#52525b',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    width: col.width,
                  }}
                >
                  {col.label}
                  <SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={row.id}
                onClick={() => toggleRow(row.id)}
                style={{
                  borderBottom: '1px solid #f4f4f5',
                  background: selected.has(row.id)
                    ? TWEAK_DEFAULTS.selectedBg
                    : i % 2 === 0
                      ? '#fff'
                      : '#fafafa',
                  cursor: 'pointer',
                  transition: 'background .1s',
                }}
              >
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'pointer', accentColor: TWEAK_DEFAULTS.accent }}
                  />
                </td>
                <td style={{ padding: '10px 14px', fontWeight: 500, color: '#18181b' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: `hsl(${(row.id * 37) % 360},65%,55%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: '#fff',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {row.name.charAt(0)}
                    </div>
                    {row.name}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', color: '#71717a' }}>{row.email}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span
                    style={{
                      padding: '2px 10px',
                      borderRadius: 6,
                      background:
                        row.role === 'Admin'
                          ? '#ede9fe'
                          : row.role === 'Viewer'
                            ? '#f0f9ff'
                            : '#f4f4f5',
                      color:
                        row.role === 'Admin'
                          ? '#6d28d9'
                          : row.role === 'Viewer'
                            ? '#0369a1'
                            : '#52525b',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {row.role}
                  </span>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <StatusBadge status={row.status} />
                </td>
                <td style={{ padding: '10px 14px', color: '#71717a' }}>{row.joined}</td>
                <td style={{ padding: '10px 14px' }}>
                  <UsageBar value={row.usage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #f4f4f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          color: '#71717a',
        }}
      >
        <span>
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of{' '}
          {filtered.length}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid #e4e4e7',
              background: '#fff',
              cursor: page === 1 ? 'default' : 'pointer',
              color: page === 1 ? '#d4d4d8' : '#52525b',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            ‹ Prev
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const pg =
              totalPages <= 5
                ? i + 1
                : page <= 3
                  ? i + 1
                  : page >= totalPages - 2
                    ? totalPages - 4 + i
                    : page - 2 + i;
            return (
              <button
                key={pg}
                onClick={() => setPage(pg)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${pg === page ? TWEAK_DEFAULTS.accent : '#e4e4e7'}`,
                  background: pg === page ? TWEAK_DEFAULTS.accent : '#fff',
                  color: pg === page ? '#fff' : '#52525b',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {pg}
              </button>
            );
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid #e4e4e7',
              background: '#fff',
              cursor: page === totalPages ? 'default' : 'pointer',
              color: page === totalPages ? '#d4d4d8' : '#52525b',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DataTable, StatusBadge, UsageBar });

function App() {
  return (
    <div style={{ minHeight: '100vh', padding: 32, background: '#f4f4f5' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'Helvetica Neue, sans-serif',
            fontSize: 24,
            fontWeight: 700,
            color: '#18181b',
            margin: '0 0 16px',
          }}
        >
          Users
        </h1>
        <DataTable />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
