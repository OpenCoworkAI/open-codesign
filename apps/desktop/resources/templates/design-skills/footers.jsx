// when_to_use: Site / app footer sections. Four variants:
// mega 5-column with brand + social, ultra-minimal one-line, dense 6-column
// link grid, and brand block + newsletter signup. Pick the variant that
// matches the page weight (mega for marketing, minimal for app).

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  bg: '#0f0f0f',
  heading: '#ffffff',
  sub: '#888888',
} /*EDITMODE-END*/;

function FooterMega({ tokens = {} }) {
  const t = {
    bg: '#0f0f0f',
    border: 'rgba(255,255,255,.08)',
    heading: '#fff',
    sub: '#888',
    accent: '#6366f1',
    ...tokens,
  };
  const cols = [
    { title: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Roadmap', 'Status'] },
    {
      title: 'Resources',
      links: ['Documentation', 'API Reference', 'Guides', 'Blog', 'Community'],
    },
    { title: 'Company', links: ['About', 'Careers', 'Press', 'Partners', 'Contact'] },
    { title: 'Legal', links: ['Privacy', 'Terms', 'Security', 'Cookies'] },
  ];
  return (
    <footer style={{ background: t.bg, fontFamily: 'Helvetica Neue, sans-serif', color: t.sub }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 40px 40px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
            gap: 40,
            marginBottom: 56,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: t.heading,
                marginBottom: 12,
                letterSpacing: -0.5,
              }}
            >
              acme<span style={{ color: t.accent }}>.</span>
            </div>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.7,
                marginBottom: 20,
                maxWidth: 220,
                color: t.sub,
              }}
            >
              The platform for modern product teams. Design, build, and ship faster together.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              {['𝕏', 'in', 'gh', 'yt'].map((icon) => (
                <a
                  key={icon}
                  href="#"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,.07)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: t.sub,
                    textDecoration: 'none',
                    fontWeight: 700,
                  }}
                >
                  {icon}
                </a>
              ))}
            </div>
          </div>
          {cols.map((col) => (
            <div key={col.title}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: t.heading,
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                  marginBottom: 16,
                }}
              >
                {col.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.links.map((link) => (
                  <a
                    key={link}
                    href="#"
                    style={{ fontSize: 13, color: t.sub, textDecoration: 'none' }}
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            borderTop: `1px solid ${t.border}`,
            paddingTop: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12 }}>© 2026 Acme Inc. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 24 }}>
            {['Privacy', 'Terms', 'Cookies'].map((l) => (
              <a key={l} href="#" style={{ fontSize: 12, color: t.sub, textDecoration: 'none' }}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterMinimal({ tokens = {} }) {
  const t = {
    bg: '#ffffff',
    border: '#e5e7eb',
    heading: '#111',
    sub: '#888',
    accent: '#6366f1',
    ...tokens,
  };
  return (
    <footer
      style={{
        background: t.bg,
        borderTop: `1px solid ${t.border}`,
        fontFamily: 'Helvetica Neue, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1000,
          margin: '0 auto',
          padding: '28px 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: t.heading, letterSpacing: -0.3 }}>
            acme<span style={{ color: t.accent }}>.</span>
          </span>
          {['Product', 'Pricing', 'Blog', 'Careers'].map((l) => (
            <a key={l} href="#" style={{ fontSize: 13, color: t.sub, textDecoration: 'none' }}>
              {l}
            </a>
          ))}
        </div>
        <span style={{ fontSize: 12, color: t.sub }}>© 2026 Acme Inc.</span>
      </div>
    </footer>
  );
}

function FooterLinkGrid({ tokens = {} }) {
  const t = {
    bg: '#f9fafb',
    border: '#e5e7eb',
    heading: '#111',
    sub: '#6b7280',
    accent: '#0ea5e9',
    ...tokens,
  };
  const sections = [
    { title: 'Platform', links: ['Features', 'Integrations', 'Enterprise', 'Security', 'Pricing'] },
    { title: 'Developers', links: ['API', 'Docs', 'SDK', 'Status', 'CLI'] },
    { title: 'Use cases', links: ['Startups', 'Agencies', 'Freelancers', 'Education'] },
    { title: 'Company', links: ['About', 'Blog', 'Press', 'Careers'] },
    { title: 'Support', links: ['Help center', 'Community', 'Contact', 'Feedback'] },
    { title: 'Social', links: ['Twitter', 'LinkedIn', 'GitHub', 'YouTube'] },
  ];
  return (
    <footer
      style={{
        background: t.bg,
        borderTop: `1px solid ${t.border}`,
        fontFamily: 'Helvetica Neue, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '56px 40px 40px' }}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: t.heading, letterSpacing: -1 }}>
            acme<span style={{ color: t.accent }}>.</span>
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 24,
            marginBottom: 48,
          }}
        >
          {sections.map((sec) => (
            <div key={sec.title}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: t.heading,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 14,
                }}
              >
                {sec.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {sec.links.map((l) => (
                  <a
                    key={l}
                    href="#"
                    style={{ fontSize: 13, color: t.sub, textDecoration: 'none' }}
                  >
                    {l}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            borderTop: `1px solid ${t.border}`,
            paddingTop: 20,
            display: 'flex',
            gap: 24,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, color: t.sub }}>© 2026 Acme Inc. · Made with care</span>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            {['Privacy', 'Terms', 'Accessibility'].map((l) => (
              <a key={l} href="#" style={{ color: t.sub, textDecoration: 'none' }}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterBrandNewsletter({ tokens = {} }) {
  const t = {
    bg: '#1e1b4b',
    accent: '#818cf8',
    heading: '#fff',
    sub: 'rgba(255,255,255,.55)',
    inputBg: 'rgba(255,255,255,.08)',
    border: 'rgba(255,255,255,.12)',
    ...tokens,
  };
  const [email, setEmail] = React.useState('');
  const [done, setDone] = React.useState(false);
  return (
    <footer style={{ background: t.bg, fontFamily: 'Helvetica Neue, sans-serif' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '64px 40px 40px' }}>
        <div style={{ display: 'flex', gap: 80, flexWrap: 'wrap', marginBottom: 56 }}>
          <div style={{ flex: '1 1 280px' }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: t.heading,
                marginBottom: 12,
                letterSpacing: -1,
              }}
            >
              acme<span style={{ color: t.accent }}>.</span>
            </div>
            <p
              style={{
                fontSize: 14,
                color: t.sub,
                lineHeight: 1.7,
                maxWidth: 260,
                margin: '0 0 28px',
              }}
            >
              Building tools that help the world create better software. Join 50,000+ makers.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {['𝕏', 'LinkedIn', 'GitHub'].map((n) => (
                <a
                  key={n}
                  href="#"
                  style={{
                    fontSize: 12,
                    color: t.sub,
                    textDecoration: 'none',
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  {n}
                </a>
              ))}
            </div>
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.heading, marginBottom: 8 }}>
              Stay in the loop
            </div>
            <p style={{ fontSize: 13, color: t.sub, margin: '0 0 20px', lineHeight: 1.6 }}>
              Product updates, design tips, and the occasional deep dive. No spam.
            </p>
            {done ? (
              <div
                style={{
                  padding: '14px 20px',
                  background: `${t.accent}20`,
                  borderRadius: 10,
                  color: t.accent,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ✓ You're in! Check your inbox.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: 10,
                    background: t.inputBg,
                    border: `1px solid ${t.border}`,
                    color: t.heading,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => email && setDone(true)}
                  style={{
                    padding: '12px 20px',
                    borderRadius: 10,
                    background: t.accent,
                    border: 'none',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Subscribe
                </button>
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            borderTop: `1px solid ${t.border}`,
            paddingTop: 24,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 12,
            color: t.sub,
          }}
        >
          <span>© 2026 Acme Inc.</span>
          <div style={{ display: 'flex', gap: 20 }}>
            {['Privacy', 'Terms', 'Security'].map((l) => (
              <a key={l} href="#" style={{ color: t.sub, textDecoration: 'none' }}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { FooterMega, FooterMinimal, FooterLinkGrid, FooterBrandNewsletter });

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
    <div style={{ minHeight: '100%', background: '#2a2a2a' }}>
      <Label name="FooterMega" />
      <FooterMega tokens={tokens} />
      <Label name="FooterMinimal" />
      <FooterMinimal />
      <Label name="FooterLinkGrid" />
      <FooterLinkGrid />
      <Label name="FooterBrandNewsletter" />
      <FooterBrandNewsletter />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
