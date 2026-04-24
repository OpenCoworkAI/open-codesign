// when_to_use: Internal data dashboards / admin consoles. Three variants:
// dark ops console with KPI strip + sparkline grid, light analytics with
// chart hero + breakdown tiles, and finance-style ledger with bold currency
// KPIs. Numbers always render in DM Sans bold or JetBrains Mono with tabular
// figures — never italic serif.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#7dd4d4',
  positive: '#4ade80',
  negative: '#f87171',
  darkBg: 'oklch(15% 0.01 260)',
  darkPanel: 'oklch(19% 0.01 260)',
  lightBg: '#f7f7f5',
  lightPanel: '#ffffff',
} /*EDITMODE-END*/;

const SANS = "'DM Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const NUM = {
  fontFamily: SANS,
  fontFeatureSettings: "'tnum'",
  fontVariantNumeric: 'tabular-nums',
  fontStyle: 'normal',
};

function Sparkline({ data, color, w = 120, h = 32 }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const step = w / (data.length - 1);
  const pts = data.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`,
  );
  const path = `M${pts.join(' L')}`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={`${path} L${w},${h} L0,${h} Z`} fill={`${color}22`} />
      <path
        d={path}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardOpsDark({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const [now, setNow] = React.useState(() => new Date().toLocaleTimeString('en-GB'));
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString('en-GB')), 1000);
    return () => clearInterval(id);
  }, []);
  const kpis = [
    {
      label: 'Requests / min',
      value: '12,418',
      delta: '+4.2%',
      up: true,
      spark: [22, 28, 24, 31, 29, 35, 38, 33, 41, 44, 42, 48],
    },
    {
      label: 'P95 latency',
      value: '183',
      unit: 'ms',
      delta: '−12 ms',
      up: true,
      spark: [220, 210, 205, 198, 200, 195, 190, 188, 185, 184, 183, 183],
    },
    {
      label: 'Error rate',
      value: '0.18',
      unit: '%',
      delta: 'stable',
      up: null,
      spark: [0.21, 0.19, 0.2, 0.18, 0.18, 0.19, 0.18, 0.17, 0.18, 0.18, 0.18, 0.18],
    },
    {
      label: 'Active users',
      value: '3,241',
      delta: '+128',
      up: true,
      spark: [2900, 2950, 3000, 3050, 3100, 3120, 3150, 3180, 3200, 3220, 3230, 3241],
    },
  ];
  const events = [
    { time: '14:02:31', kind: 'deploy', text: 'api@2.18.4 → production' },
    { time: '14:01:08', kind: 'warn', text: 'p99 latency spike (eu-west-1)' },
    { time: '13:58:44', kind: 'ok', text: 'autoscaler added 2 workers' },
    { time: '13:55:12', kind: 'deploy', text: 'web@4.0.1 → staging' },
    { time: '13:51:00', kind: 'ok', text: 'cron: nightly snapshot complete' },
  ];
  const kindColor = (k) => (k === 'warn' ? t.negative : k === 'deploy' ? t.accent : t.positive);
  return (
    <div style={{ background: t.darkBg, color: '#fff', fontFamily: SANS, padding: 24 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: '#7a8290',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Ops · Overview
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 0' }}>System health</h1>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: t.accent,
              boxShadow: `0 0 10px ${t.accent}`,
            }}
          />
          <span style={{ fontSize: 11, letterSpacing: '0.12em', color: '#aab2bc' }}>LIVE</span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: '#aab2bc', ...NUM }}>{now}</span>
        </div>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 12,
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: t.darkPanel,
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#7a8290',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {k.label}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#fff', ...NUM }}>
                {k.value}
              </span>
              {k.unit && <span style={{ fontSize: 14, color: '#7a8290' }}>{k.unit}</span>}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: k.up == null ? '#7a8290' : k.up ? t.positive : t.negative,
                  ...NUM,
                }}
              >
                {k.delta}
              </span>
              <Sparkline
                data={k.spark}
                color={k.up == null ? '#7a8290' : k.up ? t.positive : t.negative}
                w={88}
                h={26}
              />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div
          style={{
            background: t.darkPanel,
            borderRadius: 12,
            padding: 20,
            height: 260,
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#aab2bc' }}>Throughput · 24h</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#7a8290' }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    background: t.accent,
                    borderRadius: 2,
                    marginRight: 6,
                  }}
                />
                api
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    background: t.positive,
                    borderRadius: 2,
                    marginRight: 6,
                  }}
                />
                web
              </span>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <Sparkline
              data={[42, 58, 51, 64, 72, 68, 79, 85, 91, 88, 96, 102, 98, 110, 118, 112, 124]}
              color={t.accent}
              w={520}
              h={180}
            />
          </div>
        </div>
        <div
          style={{
            background: t.darkPanel,
            borderRadius: 12,
            padding: 20,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ fontSize: 13, color: '#aab2bc', marginBottom: 14 }}>Recent events</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {events.map((e, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 8px 1fr',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <span style={{ fontFamily: MONO, color: '#7a8290', ...NUM }}>{e.time}</span>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: kindColor(e.kind),
                  }}
                />
                <span style={{ color: '#cdd3db' }}>{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardAnalyticsLight({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const accent = '#0f766e';
  const breakdown = [
    { label: 'Direct', value: 42.8, color: accent },
    { label: 'Organic search', value: 28.1, color: '#f59e0b' },
    { label: 'Referral', value: 18.4, color: '#8b5cf6' },
    { label: 'Social', value: 10.7, color: '#ec4899' },
  ];
  return (
    <div style={{ background: t.lightBg, fontFamily: SANS, padding: 24, color: '#111' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              color: '#6b7280',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Acquisition
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '4px 0 0', letterSpacing: -0.5 }}>
            Last 30 days
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['7D', '30D', '90D'].map((p) => (
            <button
              key={p}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                background: p === '30D' ? '#111' : '#fff',
                color: p === '30D' ? '#fff' : '#374151',
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </header>
      <div
        style={{
          background: t.lightPanel,
          borderRadius: 14,
          padding: 24,
          border: '1px solid #e5e7eb',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 4 }}>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.5, ...NUM }}>
            248,917
          </span>
          <span style={{ fontSize: 14, color: '#16a34a', fontWeight: 600, ...NUM }}>
            ↑ 12.4% vs prev period
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Sessions</div>
        <div style={{ height: 140 }}>
          <Sparkline
            data={[
              5800, 6100, 6800, 6400, 7200, 7900, 7600, 8300, 8800, 8500, 9100, 9600, 9300, 9800,
              10200,
            ]}
            color={accent}
            w={760}
            h={140}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div
          style={{
            background: t.lightPanel,
            borderRadius: 14,
            padding: 20,
            border: '1px solid #e5e7eb',
          }}
        >
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Channels</div>
          {breakdown.map((b) => (
            <div key={b.label} style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: '#374151' }}>{b.label}</span>
                <span style={{ fontWeight: 600, ...NUM }}>{b.value.toFixed(1)}%</span>
              </div>
              <div
                style={{ height: 6, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' }}
              >
                <div
                  style={{
                    width: `${b.value * 2}%`,
                    height: '100%',
                    background: b.color,
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            background: t.lightPanel,
            borderRadius: 14,
            padding: 20,
            border: '1px solid #e5e7eb',
          }}
        >
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Top pages</div>
          {[
            ['/pricing', 41203, '+8%'],
            ['/docs/getting-started', 28814, '+22%'],
            ['/blog/v2-launch', 19004, '+44%'],
            ['/changelog', 12557, '−3%'],
          ].map(([p, v, d]) => (
            <div
              key={p}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 12,
                fontSize: 13,
                padding: '10px 0',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <span style={{ fontFamily: MONO, color: '#374151', ...NUM }}>{p}</span>
              <span style={{ fontWeight: 600, ...NUM }}>{v.toLocaleString()}</span>
              <span
                style={{
                  color: String(d).startsWith('−') ? '#dc2626' : '#16a34a',
                  fontWeight: 600,
                  minWidth: 36,
                  textAlign: 'right',
                  ...NUM,
                }}
              >
                {d}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardFinanceLedger({ tokens = {} }) {
  const _t = { ...TWEAK_DEFAULTS, ...tokens };
  const kpis = [
    { label: 'Revenue · MTD', value: '$4.81M', delta: '+18.2%', up: true },
    { label: 'Gross margin', value: '64.3%', delta: '+1.4 pts', up: true },
    { label: 'Burn · monthly', value: '$1.92M', delta: '−4.0%', up: true },
    { label: 'Runway', value: '24 mo', delta: 'stable', up: null },
  ];
  const ledger = [
    { date: '2026-04-19', desc: 'Stripe payout', amt: 184250.0, kind: '+' },
    { date: '2026-04-19', desc: 'AWS · April invoice', amt: -42118.55, kind: '−' },
    { date: '2026-04-18', desc: 'Acme Corp · annual', amt: 96000.0, kind: '+' },
    { date: '2026-04-18', desc: 'Payroll · NA', amt: -284902.1, kind: '−' },
    { date: '2026-04-17', desc: 'Refund · DV-2241', amt: -1188.0, kind: '−' },
  ];
  return (
    <div style={{ background: '#0a0a0a', color: '#fff', fontFamily: SANS, padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#9ca3af',
          }}
        >
          Finance · Q2 close
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '4px 0 0' }}>Books — April 2026</h1>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1,
          background: '#1f2937',
          borderRadius: 12,
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        {kpis.map((k) => (
          <div key={k.label} style={{ background: '#111827', padding: '20px 22px' }}>
            <div
              style={{
                fontSize: 11,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {k.label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8, letterSpacing: -1, ...NUM }}>
              {k.value}
            </div>
            <div
              style={{
                fontSize: 12,
                marginTop: 4,
                color: k.up == null ? '#9ca3af' : k.up ? '#34d399' : '#f87171',
                ...NUM,
              }}
            >
              {k.delta}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: '#111827',
          borderRadius: 12,
          padding: '20px 22px',
          border: '1px solid #1f2937',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>Ledger · most recent</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: '#6b7280', ...NUM }}>
            5 of 1,284
          </span>
        </div>
        {ledger.map((row, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr auto',
              gap: 16,
              padding: '12px 0',
              borderBottom: i < ledger.length - 1 ? '1px solid #1f2937' : 'none',
              alignItems: 'center',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 12, color: '#9ca3af', ...NUM }}>
              {row.date}
            </span>
            <span style={{ fontSize: 13 }}>{row.desc}</span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 14,
                fontWeight: 600,
                color: row.kind === '+' ? '#34d399' : '#f87171',
                ...NUM,
              }}
            >
              {row.kind === '+' ? '+' : '−'}$
              {Math.abs(row.amt).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DashboardOpsDark, DashboardAnalyticsLight, DashboardFinanceLedger });

function Label({ name }) {
  return (
    <div
      style={{
        padding: '8px 20px',
        background: '#0a0a0a',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: 'uppercase',
        fontFamily: SANS,
      }}
    >
      {name}
    </div>
  );
}

function App() {
  return (
    <div style={{ minHeight: '100%' }}>
      <Label name="DashboardOpsDark" />
      <DashboardOpsDark />
      <Label name="DashboardAnalyticsLight" />
      <DashboardAnalyticsLight />
      <Label name="DashboardFinanceLedger" />
      <DashboardFinanceLedger />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
