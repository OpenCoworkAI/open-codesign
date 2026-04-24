// when_to_use: Inline SVG charts — line, area, bar, donut, sparkline. No external
// chart libs. Pick the variant that matches the data shape (time-series → line/area,
// categorical → bar, share-of-total → donut, dense KPI inline → sparkline). All
// numerical labels render in DM Sans / mono with tabular figures, never italic.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  stroke: '#CC785C',
  fill: 'rgba(204,120,92,0.15)',
  grid: '#ece8df',
  axis: '#999999',
  bg: '#ffffff',
} /*EDITMODE-END*/;

const SANS = "'DM Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const NUM = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: "'tnum'",
  fontStyle: 'normal',
};

function LineChart({ data, w = 480, h = 200, pad = 32, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => [pad + i * step, h - pad - ((v - min) / range) * (h - pad * 2)]);
  const path = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  const ticks = 4;
  return (
    <svg width={w} height={h} style={{ background: t.bg, fontFamily: SANS }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const y = pad + (i * (h - pad * 2)) / ticks;
        const v = max - (i * range) / ticks;
        return (
          <g key={i}>
            <line x1={pad} y1={y} x2={w - pad} y2={y} stroke={t.grid} strokeWidth="1" />
            <text
              x={pad - 6}
              y={y + 4}
              textAnchor="end"
              fontSize="10"
              fill={t.axis}
              style={{ fontFamily: MONO, ...NUM }}
            >
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <path d={area} fill={t.fill} />
      <path
        d={path}
        fill="none"
        stroke={t.stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={t.bg} stroke={t.stroke} strokeWidth="2" />
      ))}
    </svg>
  );
}

function BarChart({ data, w = 480, h = 200, pad = 32, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const max = Math.max(...data.map((d) => d.value));
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const bw = (innerW / data.length) * 0.62;
  const gap = (innerW / data.length) * 0.38;
  return (
    <svg width={w} height={h} style={{ background: t.bg, fontFamily: SANS }}>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke={t.grid} strokeWidth="1" />
      {data.map((d, i) => {
        const x = pad + i * (bw + gap) + gap / 2;
        const bh = (d.value / max) * innerH;
        const y = h - pad - bh;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={bw} height={bh} rx="3" fill={t.stroke} opacity={0.85} />
            <text
              x={x + bw / 2}
              y={y - 6}
              textAnchor="middle"
              fontSize="11"
              fill={t.stroke}
              style={{ fontFamily: MONO, fontWeight: 600, ...NUM }}
            >
              {d.value}
            </text>
            <text x={x + bw / 2} y={h - pad + 16} textAnchor="middle" fontSize="11" fill={t.axis}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ segments, w = 200, h = 200, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = w / 2 - 16;
  const cx = w / 2;
  const cy = h / 2;
  let offset = 0;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 24, fontFamily: SANS }}>
      <svg width={w} height={h}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.grid} strokeWidth="20" />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = 2 * Math.PI * r;
          const node = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color || t.stroke}
              strokeWidth="20"
              strokeDasharray={`${frac * dash} ${dash}`}
              strokeDashoffset={-offset * dash}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += frac;
          return node;
        })}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="22"
          fontWeight="700"
          fill="#1a1a1a"
          style={{ ...NUM }}
        >
          {total.toLocaleString()}
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          fontSize="11"
          fill={t.axis}
          style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}
        >
          Total
        </text>
      </svg>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {segments.map((s) => (
          <li
            key={s.label}
            style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}
          >
            <span
              style={{ width: 10, height: 10, background: s.color || t.stroke, borderRadius: 2 }}
            />
            <span style={{ flex: 1 }}>{s.label}</span>
            <span style={{ fontFamily: MONO, fontWeight: 600, ...NUM }}>
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sparkline({ data, w = 100, h = 28, color, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const c = color || t.stroke;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const step = w / (data.length - 1);
  const pts = data.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`,
  );
  return (
    <svg width={w} height={h}>
      <path d={`M${pts.join(' L')} L${w},${h} L0,${h} Z`} fill={c} opacity="0.18" />
      <path
        d={`M${pts.join(' L')}`}
        stroke={c}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

Object.assign(window, { LineChart, BarChart, DonutChart, Sparkline });

function Card({ title, children }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: 24,
        border: '1px solid #ece8df',
        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 16,
          fontFamily: SANS,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function App() {
  const segs = [
    { label: 'Direct', value: 4280, color: '#CC785C' },
    { label: 'Search', value: 2810, color: '#7dd4d4' },
    { label: 'Referral', value: 1840, color: '#a78bfa' },
    { label: 'Social', value: 1070, color: '#fbbf24' },
  ];
  return (
    <div
      style={{
        minHeight: '100%',
        padding: 32,
        background: '#f5f3ee',
        fontFamily: SANS,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
      }}
    >
      <Card title="Weekly active users · LineChart">
        <LineChart data={[12, 18, 14, 22, 28, 24, 31, 29, 35, 38, 33, 41]} w={520} h={200} />
      </Card>
      <Card title="Revenue by region · BarChart">
        <BarChart
          data={[
            { label: 'NA', value: 184 },
            { label: 'EU', value: 142 },
            { label: 'APAC', value: 98 },
            { label: 'LATAM', value: 56 },
            { label: 'MEA', value: 34 },
          ]}
          w={520}
          h={200}
        />
      </Card>
      <Card title="Traffic sources · DonutChart">
        <DonutChart segments={segs} />
      </Card>
      <Card title="Inline sparklines">
        {[
          ['Sessions', [22, 28, 24, 31, 29, 35, 38, 33, 41], '#CC785C'],
          ['Signups', [4, 5, 4, 7, 6, 9, 8, 11, 13], '#16a34a'],
          ['Errors', [12, 9, 11, 8, 14, 7, 6, 4, 5], '#dc2626'],
        ].map(([label, data, color]) => (
          <div
            key={label}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              alignItems: 'center',
              gap: 16,
              padding: '12px 0',
              borderBottom: '1px solid #ece8df',
            }}
          >
            <span style={{ fontSize: 13 }}>{label}</span>
            <Sparkline data={data} color={color} />
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color, ...NUM }}>
              {data[data.length - 1]}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
