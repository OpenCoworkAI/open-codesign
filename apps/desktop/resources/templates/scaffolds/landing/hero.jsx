const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  headline: 'Design at the speed of thought',
  sub: 'Open CoDesign turns plain language into production-ready prototypes.',
  primaryCta: 'Get started',
  secondaryCta: 'See live demo',
} /*EDITMODE-END*/;

function _App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background:
          'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.25), transparent 50%), radial-gradient(circle at 80% 60%, rgba(236,72,153,0.18), transparent 50%), #0b0f1a',
        color: '#f8fafc',
        padding: '96px 32px',
        fontFamily: 'Inter, system-ui',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ maxWidth: 920, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(99,102,241,0.15)',
            color: TWEAK_DEFAULTS.accent,
            fontSize: 13,
            marginBottom: 24,
            border: '1px solid rgba(99,102,241,0.3)',
          }}
        >
          New · v0.2 release
        </div>
        <h1
          style={{
            fontSize: 64,
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: -1.5,
            margin: 0,
          }}
        >
          {TWEAK_DEFAULTS.headline}
        </h1>
        <p
          style={{
            marginTop: 20,
            fontSize: 20,
            color: '#cbd5e1',
            lineHeight: 1.5,
          }}
        >
          {TWEAK_DEFAULTS.sub}
        </p>
        <div
          style={{
            marginTop: 36,
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            style={{
              padding: '14px 24px',
              background: TWEAK_DEFAULTS.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 12px 30px rgba(99,102,241,0.4)',
            }}
          >
            {TWEAK_DEFAULTS.primaryCta}
          </button>
          <button
            type="button"
            style={{
              padding: '14px 24px',
              background: 'rgba(255,255,255,0.06)',
              color: '#f8fafc',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {TWEAK_DEFAULTS.secondaryCta}
          </button>
        </div>
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            gap: 24,
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: 13,
          }}
        >
          <span>· No account required</span>
          <span>· BYOK: any provider</span>
          <span>· MIT license</span>
        </div>
      </div>
    </div>
  );
}
