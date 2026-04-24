// when_to_use: SaaS / product pricing sections. Four variants:
// 3-tier cards with highlighted plan, full feature comparison table,
// single-CTA flat-price hero, and freemium with monthly/annual toggle.
// Pick the variant that matches the pricing model.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  bg: '#fafafa',
  heading: '#111111',
  sub: '#666666',
} /*EDITMODE-END*/;

function Pricing3TierCards({ tokens = {} }) {
  const t = {
    bg: '#fafafa',
    accent: '#6366f1',
    heading: '#111',
    sub: '#666',
    cardBg: '#fff',
    ...tokens,
  };
  const plans = [
    {
      name: 'Starter',
      price: '$0',
      period: '/mo',
      desc: 'For individuals getting started',
      features: ['5 projects', '3 team members', '5GB storage', 'Basic analytics', 'Email support'],
      cta: 'Get started',
      highlight: false,
    },
    {
      name: 'Pro',
      price: '$29',
      period: '/mo',
      desc: 'For growing teams shipping fast',
      features: [
        'Unlimited projects',
        '15 team members',
        '100GB storage',
        'Advanced analytics',
        'Priority support',
        'Custom domains',
        'API access',
      ],
      cta: 'Start free trial',
      highlight: true,
    },
    {
      name: 'Enterprise',
      price: '$99',
      period: '/mo',
      desc: 'For orgs that need full control',
      features: [
        'Unlimited everything',
        'Unlimited members',
        '1TB storage',
        'Custom analytics',
        'Dedicated support',
        'SSO / SAML',
        'SLA guarantee',
        'Audit logs',
      ],
      cta: 'Contact sales',
      highlight: false,
    },
  ];
  return (
    <section
      style={{ background: t.bg, padding: '64px 40px', fontFamily: 'Helvetica Neue, sans-serif' }}
    >
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <h2
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: t.heading,
            margin: '0 0 12px',
            letterSpacing: -1,
          }}
        >
          Simple, honest pricing
        </h2>
        <p style={{ color: t.sub, fontSize: 16 }}>No surprises. Cancel anytime.</p>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 20,
          justifyContent: 'center',
          flexWrap: 'wrap',
          maxWidth: 960,
          margin: '0 auto',
        }}
      >
        {plans.map((plan) => (
          <div
            key={plan.name}
            style={{
              flex: '1 1 260px',
              maxWidth: 300,
              background: plan.highlight ? t.accent : t.cardBg,
              borderRadius: 16,
              padding: '32px 28px',
              boxShadow: plan.highlight
                ? `0 16px 48px ${t.accent}40`
                : '0 2px 16px rgba(0,0,0,.06)',
              border: plan.highlight ? 'none' : '1px solid #e5e7eb',
              position: 'relative',
              transform: plan.highlight ? 'scale(1.04)' : 'none',
            }}
          >
            {plan.highlight && (
              <div
                style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#fff',
                  color: t.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 14px',
                  borderRadius: 20,
                  letterSpacing: 1,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(0,0,0,.1)',
                }}
              >
                MOST POPULAR
              </div>
            )}
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: plan.highlight ? 'rgba(255,255,255,.75)' : t.sub,
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {plan.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  color: plan.highlight ? '#fff' : t.heading,
                  letterSpacing: -1,
                }}
              >
                {plan.price}
              </span>
              <span
                style={{ fontSize: 14, color: plan.highlight ? 'rgba(255,255,255,.65)' : t.sub }}
              >
                {plan.period}
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                color: plan.highlight ? 'rgba(255,255,255,.7)' : t.sub,
                margin: '0 0 24px',
                lineHeight: 1.5,
              }}
            >
              {plan.desc}
            </p>
            <button
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 10,
                border: 'none',
                background: plan.highlight ? '#fff' : t.accent,
                color: plan.highlight ? t.accent : '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: 24,
              }}
            >
              {plan.cta}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plan.features.map((f) => (
                <div
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    color: plan.highlight ? 'rgba(255,255,255,.85)' : t.heading,
                  }}
                >
                  <span
                    style={{
                      color: plan.highlight ? '#fff' : t.accent,
                      flexShrink: 0,
                      fontWeight: 700,
                      fontSize: 15,
                    }}
                  >
                    ✓
                  </span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingTableComparison({ tokens = {} }) {
  const t = { bg: '#fff', accent: '#0ea5e9', heading: '#0f172a', sub: '#64748b', ...tokens };
  const rows = [
    { feature: 'Projects', starter: '5', pro: 'Unlimited', enterprise: 'Unlimited' },
    { feature: 'Team members', starter: '3', pro: '15', enterprise: 'Unlimited' },
    { feature: 'Storage', starter: '5 GB', pro: '100 GB', enterprise: '1 TB' },
    { feature: 'API access', starter: false, pro: true, enterprise: true },
    { feature: 'Custom domains', starter: false, pro: true, enterprise: true },
    { feature: 'SSO / SAML', starter: false, pro: false, enterprise: true },
    { feature: 'Audit logs', starter: false, pro: false, enterprise: true },
    { feature: 'SLA', starter: false, pro: '99.9%', enterprise: '99.99%' },
    { feature: 'Support', starter: 'Email', pro: 'Priority', enterprise: 'Dedicated' },
  ];
  const cols = ['Feature', 'Starter', 'Pro', 'Enterprise'];
  const prices = ['—', '$0/mo', '$29/mo', '$99/mo'];
  const Cell = ({ val, isHeader }) => {
    if (isHeader)
      return (
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: t.sub,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {val}
        </div>
      );
    if (val === true)
      return <span style={{ color: t.accent, fontSize: 18, fontWeight: 700 }}>✓</span>;
    if (val === false) return <span style={{ color: '#e2e8f0', fontSize: 18 }}>—</span>;
    return <span style={{ fontSize: 13, color: t.heading }}>{val}</span>;
  };
  return (
    <section
      style={{ background: t.bg, padding: '64px 40px', fontFamily: 'Helvetica Neue, sans-serif' }}
    >
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <h2
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: t.heading,
            margin: '0 0 12px',
            letterSpacing: -1,
          }}
        >
          Compare plans
        </h2>
        <p style={{ color: t.sub, fontSize: 16 }}>Everything you need to make the right choice.</p>
      </div>
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: '#f8fafc' }}
        >
          {cols.map((c, i) => (
            <div
              key={c}
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                borderRight: i < 3 ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <Cell val={c} isHeader />
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: i === 2 ? t.accent : t.heading,
                  marginTop: 4,
                }}
              >
                {prices[i]}
              </div>
            </div>
          ))}
        </div>
        {rows.map((row, ri) => (
          <div
            key={row.feature}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr',
              background: ri % 2 === 0 ? '#fff' : '#fafafa',
            }}
          >
            <div
              style={{
                padding: '14px 20px',
                borderRight: '1px solid #e2e8f0',
                fontSize: 13,
                fontWeight: 500,
                color: t.heading,
              }}
            >
              {row.feature}
            </div>
            {['starter', 'pro', 'enterprise'].map((k, i) => (
              <div
                key={k}
                style={{
                  padding: '14px 20px',
                  borderRight: i < 2 ? '1px solid #e2e8f0' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: k === 'pro' ? `${t.accent}06` : 'transparent',
                }}
              >
                <Cell val={row[k]} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingSingleCTA({ tokens = {} }) {
  const t = {
    bg: '#0c1019',
    accent: '#22d3ee',
    heading: '#fff',
    sub: 'rgba(255,255,255,.55)',
    ...tokens,
  };
  const features = [
    'Unlimited projects & workspaces',
    'All integrations included',
    'Priority email & chat support',
    'Custom domain & white-label',
    'Advanced analytics dashboard',
    'Team roles & permissions',
  ];
  return (
    <section
      style={{
        background: t.bg,
        padding: '80px 40px',
        fontFamily: 'Helvetica Neue, sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 580, margin: '0 auto' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '5px 16px',
            borderRadius: 20,
            background: `${t.accent}18`,
            border: `1px solid ${t.accent}44`,
            color: t.accent,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: 'uppercase',
            marginBottom: 32,
          }}
        >
          Everything, one price
        </div>
        <h2
          style={{
            fontSize: 'clamp(28px,5vw,52px)',
            fontWeight: 700,
            color: t.heading,
            margin: '0 0 12px',
            letterSpacing: -1.5,
            lineHeight: 1.1,
          }}
        >
          $49 <span style={{ fontSize: '0.5em', fontWeight: 400, color: t.sub }}>/ month</span>
        </h2>
        <p style={{ fontSize: 16, color: t.sub, lineHeight: 1.6, margin: '0 0 40px' }}>
          One flat price. No seats, no tiers, no surprises. Switch off anytime.
        </p>
        <div
          style={{
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 16,
            padding: '28px 32px',
            marginBottom: 36,
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
            {features.map((f) => (
              <div
                key={f}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: 14,
                  color: t.heading,
                }}
              >
                <span style={{ color: t.accent, marginTop: 1, flexShrink: 0 }}>✓</span>
                {f}
              </div>
            ))}
          </div>
        </div>
        <button
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 12,
            background: t.accent,
            border: 'none',
            color: '#000',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginBottom: 16,
          }}
        >
          Start your free trial
        </button>
        <p style={{ fontSize: 12, color: t.sub }}>
          14-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}

function PricingFreemiumToggle({ tokens = {} }) {
  const t = {
    bg: '#fafaf9',
    accent: '#7c3aed',
    heading: '#111',
    sub: '#666',
    cardBg: '#fff',
    ...tokens,
  };
  const [annual, setAnnual] = React.useState(false);
  const plans = [
    {
      name: 'Free',
      monthly: 0,
      annual: 0,
      features: ['3 projects', '1 user', '1 GB', 'Community support'],
    },
    {
      name: 'Growth',
      monthly: 19,
      annual: 15,
      features: ['20 projects', '5 users', '50 GB', 'Email support', 'Analytics'],
      highlight: true,
    },
    {
      name: 'Scale',
      monthly: 49,
      annual: 39,
      features: [
        'Unlimited projects',
        '20 users',
        '500 GB',
        'Priority support',
        'Advanced analytics',
        'API',
      ],
    },
  ];
  return (
    <section
      style={{ background: t.bg, padding: '64px 40px', fontFamily: 'Helvetica Neue, sans-serif' }}
    >
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h2
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: t.heading,
            margin: '0 0 24px',
            letterSpacing: -1,
          }}
        >
          Choose your plan
        </h2>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            background: '#f0edf7',
            borderRadius: 40,
            padding: '6px 8px',
            fontSize: 13,
          }}
        >
          <button
            onClick={() => setAnnual(false)}
            style={{
              padding: '7px 20px',
              borderRadius: 30,
              background: !annual ? t.accent : 'transparent',
              color: !annual ? '#fff' : t.sub,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            style={{
              padding: '7px 20px',
              borderRadius: 30,
              background: annual ? t.accent : 'transparent',
              color: annual ? '#fff' : t.sub,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            Annual{' '}
            <span
              style={{
                fontSize: 10,
                background: '#dcfce7',
                color: '#16a34a',
                padding: '2px 7px',
                borderRadius: 10,
                fontWeight: 700,
              }}
            >
              −20%
            </span>
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 20,
          justifyContent: 'center',
          flexWrap: 'wrap',
          maxWidth: 860,
          margin: '0 auto',
        }}
      >
        {plans.map((plan) => (
          <div
            key={plan.name}
            style={{
              flex: '1 1 220px',
              maxWidth: 260,
              background: plan.highlight ? t.accent : t.cardBg,
              borderRadius: 16,
              padding: '28px 24px',
              boxShadow: plan.highlight
                ? `0 16px 40px ${t.accent}35`
                : '0 2px 12px rgba(0,0,0,.06)',
              border: plan.highlight ? 'none' : '1px solid #e5e7eb',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: plan.highlight ? 'rgba(255,255,255,.65)' : t.sub,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {plan.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 24 }}>
              <span
                style={{
                  fontSize: 36,
                  fontWeight: 700,
                  color: plan.highlight ? '#fff' : t.heading,
                  letterSpacing: -1,
                }}
              >
                {annual ? `$${plan.annual}` : plan.monthly === 0 ? 'Free' : `$${plan.monthly}`}
              </span>
              {plan.monthly > 0 && (
                <span
                  style={{ fontSize: 12, color: plan.highlight ? 'rgba(255,255,255,.55)' : t.sub }}
                >
                  /mo
                </span>
              )}
            </div>
            <button
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: 8,
                border: 'none',
                background: plan.highlight ? '#fff' : t.accent,
                color: plan.highlight ? t.accent : '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: 20,
              }}
            >
              {plan.monthly === 0 ? 'Get started' : 'Try free'}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {plan.features.map((f) => (
                <div
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: plan.highlight ? 'rgba(255,255,255,.85)' : t.heading,
                  }}
                >
                  <span style={{ color: plan.highlight ? '#fff' : t.accent, fontWeight: 700 }}>
                    ✓
                  </span>{' '}
                  {f}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

Object.assign(window, {
  Pricing3TierCards,
  PricingTableComparison,
  PricingSingleCTA,
  PricingFreemiumToggle,
});

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
        fontFamily: 'Helvetica Neue, sans-serif',
      }}
    >
      {name}
    </div>
  );
}

function App() {
  const tokens = {
    accent: TWEAK_DEFAULTS.accent,
    bg: TWEAK_DEFAULTS.bg,
    heading: TWEAK_DEFAULTS.heading,
    sub: TWEAK_DEFAULTS.sub,
  };
  return (
    <div style={{ minHeight: '100%', background: '#1a1a1a' }}>
      <Label name="Pricing3TierCards" />
      <Pricing3TierCards tokens={tokens} />
      <Label name="PricingTableComparison" />
      <PricingTableComparison />
      <Label name="PricingSingleCTA" />
      <PricingSingleCTA />
      <Label name="PricingFreemiumToggle" />
      <PricingFreemiumToggle />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
