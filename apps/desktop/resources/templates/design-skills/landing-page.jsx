// when_to_use: Full marketing landing pages — hero + social proof + features
// + testimonial + CTA. Three variants: editorial-serif (Fraunces, generous
// whitespace), product-tech (dense feature grid, dark accents), and minimal-
// startup (single column, big type, single CTA). For just the hero section,
// use heroes.jsx instead.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#CC785C',
  bg: '#fafaf7',
  ink: '#1a1a1a',
  muted: '#666666',
  panel: '#ffffff',
  rule: '#ece8df',
} /*EDITMODE-END*/;

const SERIF = "'Fraunces', 'DM Serif Display', Georgia, serif";
const SANS = "'DM Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const NUM = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: "'tnum'",
  fontStyle: 'normal',
};

function LandingEditorial({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  const features = [
    {
      eyebrow: '01',
      title: 'Speed',
      body: 'From idea to working prototype in an afternoon. The system holds while you move.',
    },
    {
      eyebrow: '02',
      title: 'Trust',
      body: 'Tokens, components, and content all version-controlled. Nothing drifts in private files.',
    },
    {
      eyebrow: '03',
      title: 'Craft',
      body: 'Designed by people who ship products, not by people who write framework manifestos.',
    },
  ];
  return (
    <div style={{ background: t.bg, color: t.ink, fontFamily: SANS }}>
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '24px 56px',
          alignItems: 'center',
          borderBottom: `1px solid ${t.rule}`,
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500 }}>Field Studio</div>
        <div
          style={{ display: 'flex', gap: 28, fontSize: 14, alignItems: 'center', color: t.muted }}
        >
          <a style={{ color: 'inherit' }}>Work</a>
          <a style={{ color: 'inherit' }}>Journal</a>
          <a style={{ color: 'inherit' }}>About</a>
          <button
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              background: t.ink,
              color: '#fff',
              border: 'none',
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Contact
          </button>
        </div>
      </nav>
      <section style={{ padding: '120px 56px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: t.accent,
            marginBottom: 24,
          }}
        >
          Volume 03 — Spring 2026
        </div>
        <h1
          style={{
            fontFamily: SERIF,
            fontSize: 'clamp(56px, 8vw, 104px)',
            lineHeight: 1.02,
            fontWeight: 400,
            letterSpacing: -2.5,
            margin: '0 0 32px',
            maxWidth: 980,
          }}
        >
          A studio for things <span style={{ fontStyle: 'italic' }}>that take time</span> to make
          right.
        </h1>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr',
            gap: 80,
            alignItems: 'start',
          }}
        >
          <p style={{ fontSize: 19, color: t.muted, lineHeight: 1.6, margin: 0, maxWidth: 520 }}>
            We build product and brand systems for teams who care about the small details. No
            frameworks, no playbooks — just careful work, finished slowly.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              style={{
                padding: '16px 28px',
                borderRadius: 999,
                background: t.accent,
                color: '#fff',
                border: 'none',
                fontSize: 15,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              See selected work →
            </button>
            <button
              style={{
                padding: '16px 28px',
                borderRadius: 999,
                background: 'transparent',
                color: t.ink,
                border: `1px solid ${t.rule}`,
                fontSize: 15,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Read the journal
            </button>
          </div>
        </div>
      </section>
      <section
        style={{
          padding: '32px 56px',
          borderTop: `1px solid ${t.rule}`,
          borderBottom: `1px solid ${t.rule}`,
          background: t.panel,
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 24,
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: t.muted,
            }}
          >
            Trusted by
          </span>
          {['Acme', 'Linear', 'Vercel', 'Notion', 'Figma'].map((n) => (
            <span
              key={n}
              style={{ fontFamily: SERIF, fontSize: 22, color: t.muted, fontWeight: 500 }}
            >
              {n}
            </span>
          ))}
        </div>
      </section>
      <section
        style={{
          padding: '96px 56px',
          maxWidth: 1100,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 56,
        }}
      >
        {features.map((f) => (
          <div key={f.title}>
            <div
              style={{ fontFamily: MONO, fontSize: 12, color: t.accent, marginBottom: 16, ...NUM }}
            >
              {f.eyebrow}
            </div>
            <h3
              style={{
                fontFamily: SERIF,
                fontSize: 32,
                fontWeight: 400,
                margin: '0 0 12px',
                letterSpacing: -0.5,
              }}
            >
              {f.title}
            </h3>
            <p style={{ fontSize: 15, color: t.muted, lineHeight: 1.65, margin: 0 }}>{f.body}</p>
          </div>
        ))}
      </section>
      <section
        style={{ padding: '80px 56px', background: t.ink, color: '#fff', textAlign: 'center' }}
      >
        <blockquote
          style={{
            fontFamily: SERIF,
            fontSize: 32,
            fontWeight: 400,
            fontStyle: 'italic',
            lineHeight: 1.4,
            margin: '0 auto 24px',
            maxWidth: 720,
          }}
        >
          "Field worked the brief like it mattered. The system they built still feels right two
          years on."
        </blockquote>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          Sara Lin · Head of Design, Loom
        </div>
      </section>
    </div>
  );
}

function LandingProductTech({ tokens = {} }) {
  const t = {
    ...TWEAK_DEFAULTS,
    accent: '#6366f1',
    ink: '#0b1020',
    muted: '#94a3b8',
    bg: '#fafafe',
  };
  const stats = [
    ['240+', 'Components'],
    ['98.99%', 'Uptime · 90d'],
    ['<50', 'ms · p95'],
    ['12k+', 'Teams'],
  ];
  const features = [
    {
      i: '⚡',
      title: 'Edge runtime',
      body: 'Cold starts under 30 ms in 18 regions. Zero config required.',
    },
    { i: '🛡️', title: 'SSO + audit', body: 'SAML, SCIM, and granular audit logs ready on day one.' },
    { i: '🔌', title: 'Open APIs', body: 'REST and GraphQL with typed SDKs for TS, Python, Go.' },
    {
      i: '📊',
      title: 'Live insights',
      body: 'Real-time dashboards. Custom metrics. Instant alerts.',
    },
    {
      i: '🤝',
      title: 'Team handoff',
      body: 'Comment on anything. Resolve threads. Ship together.',
    },
    {
      i: '🌍',
      title: 'Global by default',
      body: 'i18n primitives, RTL support, locale-aware formatting.',
    },
  ];
  return (
    <div style={{ background: t.bg, color: t.ink, fontFamily: SANS }}>
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '18px 40px',
          alignItems: 'center',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}
        >
          <span style={{ width: 24, height: 24, borderRadius: 6, background: t.accent }} /> Vector
        </div>
        <div
          style={{ display: 'flex', gap: 24, fontSize: 14, color: t.muted, alignItems: 'center' }}
        >
          <a style={{ color: 'inherit' }}>Product</a>
          <a style={{ color: 'inherit' }}>Pricing</a>
          <a style={{ color: 'inherit' }}>Docs</a>
          <a style={{ color: 'inherit' }}>Customers</a>
          <button
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              background: t.accent,
              color: '#fff',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Start free
          </button>
        </div>
      </nav>
      <section
        style={{ padding: '80px 40px', maxWidth: 1080, margin: '0 auto', textAlign: 'center' }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '4px 14px',
            borderRadius: 20,
            background: `${t.accent}15`,
            color: t.accent,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 24,
            letterSpacing: 0.3,
          }}
        >
          New · v3 just shipped
        </div>
        <h1
          style={{
            fontSize: 'clamp(36px, 6vw, 64px)',
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: -1.5,
            margin: '0 0 20px',
          }}
        >
          Ship faster.
          <br />
          Sleep better.
        </h1>
        <p
          style={{
            fontSize: 18,
            color: t.muted,
            maxWidth: 560,
            margin: '0 auto 32px',
            lineHeight: 1.6,
          }}
        >
          The infrastructure platform that handles edge, auth, and observability so your team can
          focus on the product.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            style={{
              padding: '14px 28px',
              borderRadius: 10,
              background: t.ink,
              color: '#fff',
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Start free →
          </button>
          <button
            style={{
              padding: '14px 28px',
              borderRadius: 10,
              background: '#fff',
              color: t.ink,
              border: '1px solid #e5e7eb',
              fontSize: 15,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Read docs
          </button>
        </div>
        <div
          style={{ marginTop: 56, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}
        >
          {stats.map(([v, l]) => (
            <div key={l}>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1, ...NUM }}>{v}</div>
              <div
                style={{
                  fontSize: 12,
                  color: t.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginTop: 4,
                }}
              >
                {l}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section style={{ padding: '80px 40px', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 36, fontWeight: 700, margin: '0 0 12px', letterSpacing: -1 }}>
            Everything you'd build, already built.
          </h2>
          <p style={{ fontSize: 16, color: t.muted }}>The boring infrastructure, done well.</p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            background: '#e5e7eb',
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #e5e7eb',
          }}
        >
          {features.map((f) => (
            <div key={f.title} style={{ background: '#fff', padding: '32px 28px' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: `${t.accent}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                  fontSize: 18,
                }}
              >
                {f.i}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: t.muted, lineHeight: 1.6, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LandingMinimalStartup({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens, bg: '#fffef9', ink: '#0a0a0a', accent: '#000' };
  return (
    <div style={{ background: t.bg, color: t.ink, fontFamily: SANS, minHeight: 600 }}>
      <nav
        style={{
          padding: '32px 48px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, letterSpacing: -0.5 }}>
          monolith
        </div>
        <a style={{ fontSize: 13, color: '#666' }}>hello@monolith.studio</a>
      </nav>
      <section style={{ padding: '120px 48px 80px', maxWidth: 720, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: SERIF,
            fontSize: 'clamp(48px, 7vw, 84px)',
            lineHeight: 1.04,
            fontWeight: 400,
            letterSpacing: -2,
            margin: '0 0 32px',
          }}
        >
          One product. One promise. <span style={{ fontStyle: 'italic' }}>No fluff.</span>
        </h1>
        <p
          style={{
            fontSize: 19,
            color: '#444',
            lineHeight: 1.7,
            margin: '0 0 48px',
            maxWidth: 560,
          }}
        >
          The simplest way to write, edit, and publish technical documentation. Markdown in,
          beautiful site out, version-controlled the entire way.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button
            style={{
              padding: '14px 32px',
              borderRadius: 8,
              background: t.accent,
              color: '#fff',
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try it free
          </button>
          <a
            style={{
              fontSize: 14,
              color: '#666',
              borderBottom: '1px solid currentColor',
              paddingBottom: 2,
            }}
          >
            See it in action →
          </a>
        </div>
        <div
          style={{
            marginTop: 80,
            paddingTop: 32,
            borderTop: '1px solid #e0d8c8',
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#999',
          }}
        >
          Made in Brooklyn · Est. 2024
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { LandingEditorial, LandingProductTech, LandingMinimalStartup });

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
      <Label name="LandingEditorial" />
      <LandingEditorial />
      <Label name="LandingProductTech" />
      <LandingProductTech />
      <Label name="LandingMinimalStartup" />
      <LandingMinimalStartup />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
