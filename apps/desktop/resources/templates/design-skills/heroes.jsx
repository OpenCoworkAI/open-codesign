// when_to_use: Marketing landing-page hero sections. Five variants:
// centered CTA with badge, left-aligned with image slot, split-screen,
// video / animated background, and minimal serif typography. Pick the
// variant that matches the brand voice; copy its function into your file
// and override the `tokens` prop to recolor.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  bg: '#0f0f0f',
  heading: '#ffffff',
  sub: '#a1a1aa',
} /*EDITMODE-END*/;

function HeroCenteredCTA({ tokens = {} }) {
  const t = {
    bg: '#0f0f0f',
    accent: '#6366f1',
    heading: '#ffffff',
    sub: '#a1a1aa',
    btnText: '#fff',
    ...tokens,
  };
  return (
    <section
      style={{
        background: t.bg,
        minHeight: 480,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 40px',
        fontFamily: 'Helvetica Neue, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 600,
          height: 400,
          background: `radial-gradient(ellipse at center, ${t.accent}22 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      <div style={{ textAlign: 'center', maxWidth: 680, position: 'relative' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '5px 14px',
            borderRadius: 20,
            border: `1px solid ${t.accent}55`,
            color: t.accent,
            fontSize: 12,
            letterSpacing: 1,
            textTransform: 'uppercase',
            marginBottom: 28,
            fontWeight: 600,
          }}
        >
          New · Spring 2026
        </div>
        <h1
          style={{
            fontSize: 'clamp(36px, 5vw, 64px)',
            fontWeight: 700,
            color: t.heading,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            margin: '0 0 20px',
          }}
        >
          Build faster.
          <br />
          Ship with confidence.
        </h1>
        <p
          style={{
            fontSize: 18,
            color: t.sub,
            lineHeight: 1.6,
            margin: '0 0 40px',
            maxWidth: 480,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          The platform that helps teams design, iterate, and ship products at the speed of thought.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            style={{
              padding: '14px 32px',
              borderRadius: 10,
              background: t.accent,
              border: 'none',
              color: t.btnText,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Get started free
          </button>
          <button
            style={{
              padding: '14px 32px',
              borderRadius: 10,
              background: 'transparent',
              border: `1px solid ${t.sub}44`,
              color: t.sub,
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            See demo →
          </button>
        </div>
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            gap: 32,
            justifyContent: 'center',
            color: t.sub,
            fontSize: 12,
          }}
        >
          {['No credit card', 'Free 14-day trial', '10k+ teams'].map((x) => (
            <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: t.accent }}>✓</span> {x}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroLeftAlignedImage({ tokens = {} }) {
  const t = { bg: '#fafaf9', accent: '#e85d24', heading: '#111', sub: '#555', ...tokens };
  return (
    <section
      style={{
        background: t.bg,
        minHeight: 480,
        display: 'flex',
        alignItems: 'center',
        padding: '60px 64px',
        fontFamily: 'Helvetica Neue, sans-serif',
        gap: 64,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 380px', maxWidth: 520 }}>
        <div
          style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: 4,
            background: `${t.accent}15`,
            color: t.accent,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            marginBottom: 24,
          }}
        >
          Design System
        </div>
        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 52px)',
            fontWeight: 800,
            color: t.heading,
            lineHeight: 1.08,
            letterSpacing: -1.5,
            margin: '0 0 20px',
          }}
        >
          Your entire
          <br />
          design workflow,
          <br />
          in one place.
        </h1>
        <p style={{ fontSize: 16, color: t.sub, lineHeight: 1.65, margin: '0 0 36px' }}>
          From tokens to components to production — keep your team aligned and your brand consistent
          across every product.
        </p>
        <button
          style={{
            padding: '13px 28px',
            borderRadius: 8,
            background: t.accent,
            border: 'none',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Start building →
        </button>
        <div style={{ marginTop: 40, display: 'flex', gap: 32, color: t.sub, fontSize: 13 }}>
          {[
            ['240+', 'Components'],
            ['98%', 'Uptime'],
            ['50ms', 'Avg load'],
          ].map(([val, label]) => (
            <div key={label}>
              <div style={{ fontSize: 22, fontWeight: 700, color: t.heading }}>{val}</div>
              <div>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          flex: '1 1 320px',
          minHeight: 300,
          background: `linear-gradient(135deg, ${t.accent}18, ${t.accent}08)`,
          borderRadius: 16,
          border: `1px solid ${t.accent}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: t.sub,
          fontSize: 12,
          fontStyle: 'italic',
        }}
      >
        product screenshot
      </div>
    </section>
  );
}

function HeroSplitScreen({ tokens = {} }) {
  const t = {
    bgLeft: '#1a1a2e',
    bgRight: '#f0f0f5',
    accent: '#7c3aed',
    headingLeft: '#fff',
    headingRight: '#1a1a2e',
    sub: '#a1a1aa',
    ...tokens,
  };
  return (
    <section style={{ minHeight: 480, display: 'flex', fontFamily: 'Helvetica Neue, sans-serif' }}>
      <div
        style={{
          flex: 1,
          background: t.bgLeft,
          padding: '72px 60px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <h1
            style={{
              fontSize: 'clamp(28px, 3.5vw, 48px)',
              fontWeight: 700,
              color: t.headingLeft,
              lineHeight: 1.12,
              letterSpacing: -1,
              margin: '0 0 20px',
            }}
          >
            Where ideas
            <br />
            become products.
          </h1>
          <p style={{ fontSize: 15, color: t.sub, lineHeight: 1.65, margin: '0 0 36px' }}>
            Collaborate in real-time. Design with production-ready components. Deploy with one
            click.
          </p>
          <button
            style={{
              padding: '13px 28px',
              borderRadius: 8,
              background: t.accent,
              border: 'none',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Get started
          </button>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          background: t.bgRight,
          padding: '72px 60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -60,
            right: -60,
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: `${t.accent}12`,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            width: '100%',
            maxWidth: 340,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {['Design', 'Prototype', 'Ship'].map((step, i) => (
            <div
              key={step}
              style={{
                padding: '20px 24px',
                background: '#fff',
                borderRadius: 14,
                boxShadow: '0 2px 20px rgba(0,0,0,.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transform: `translateX(${i * 12}px)`,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: `${t.accent}18`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {['✏️', '⚡', '🚀'][i]}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: t.headingRight }}>{step}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {
                    [
                      'Craft pixel-perfect layouts',
                      'Connect flows & interactions',
                      'Publish to production',
                    ][i]
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroVideoBg({ tokens = {} }) {
  const t = {
    overlay: 'rgba(0,0,0,0.62)',
    accent: '#f59e0b',
    heading: '#fff',
    sub: 'rgba(255,255,255,.7)',
    ...tokens,
  };
  return (
    <section
      style={{
        minHeight: 480,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Helvetica Neue, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)',
          animation: 'vidBgShift 8s ease-in-out infinite alternate',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: t.overlay }} />
      <style>
        {
          '@keyframes vidBgShift { 0% { filter: hue-rotate(0deg) brightness(1); } 100% { filter: hue-rotate(30deg) brightness(1.15); } }'
        }
      </style>
      <div
        style={{ position: 'relative', textAlign: 'center', maxWidth: 700, padding: '80px 40px' }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: t.accent,
            marginBottom: 24,
            fontWeight: 600,
          }}
        >
          Watch the story
        </div>
        <h1
          style={{
            fontSize: 'clamp(36px, 5vw, 68px)',
            fontWeight: 800,
            color: t.heading,
            lineHeight: 1.05,
            letterSpacing: -2,
            margin: '0 0 24px',
          }}
        >
          A new era
          <br />
          of creation.
        </h1>
        <p style={{ fontSize: 17, color: t.sub, lineHeight: 1.6, margin: '0 0 44px' }}>
          Experience the platform that's redefining how the world's best teams build software.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            style={{
              padding: '14px 32px',
              borderRadius: 40,
              background: t.accent,
              border: 'none',
              color: '#000',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: -0.2,
            }}
          >
            Start now
          </button>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 24px',
              borderRadius: 40,
              background: 'rgba(255,255,255,.12)',
              border: '1px solid rgba(255,255,255,.25)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'rgba(255,255,255,.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
              }}
            >
              ▶
            </span>
            Watch video
          </button>
        </div>
      </div>
    </section>
  );
}

function HeroMinimalTypography({ tokens = {} }) {
  const t = {
    bg: '#fffef9',
    accent: '#000',
    heading: '#0a0a0a',
    sub: '#666',
    serif: 'Georgia, Times, serif',
    ...tokens,
  };
  return (
    <section
      style={{
        background: t.bg,
        minHeight: 480,
        display: 'flex',
        alignItems: 'center',
        padding: '80px 64px',
        fontFamily: 'Helvetica Neue, sans-serif',
        borderBottom: '1px solid #e5e5e5',
      }}
    >
      <div style={{ maxWidth: 800, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginBottom: 20 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: '#999',
              fontWeight: 500,
            }}
          >
            Est. 2024
          </span>
          <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
          <span
            style={{
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: '#999',
              fontWeight: 500,
            }}
          >
            Vol. 02
          </span>
        </div>
        <h1
          style={{
            fontFamily: t.serif,
            fontSize: 'clamp(40px, 7vw, 88px)',
            fontWeight: 400,
            color: t.heading,
            lineHeight: 1.02,
            letterSpacing: -2,
            margin: '0 0 32px',
            fontStyle: 'italic',
          }}
        >
          Craft that speaks
          <br />
          <span
            style={{
              fontStyle: 'normal',
              fontWeight: 700,
              fontFamily: 'Helvetica Neue, sans-serif',
              letterSpacing: -3,
            }}
          >
            for itself.
          </span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 64, flexWrap: 'wrap' }}>
          <p
            style={{
              flex: '1 1 280px',
              fontSize: 16,
              color: t.sub,
              lineHeight: 1.7,
              margin: 0,
              maxWidth: 420,
            }}
          >
            We believe in the power of restraint. Every pixel intentional. Every word chosen. Design
            that endures.
          </p>
          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a
              href="#"
              style={{
                fontSize: 14,
                color: t.accent,
                textDecoration: 'none',
                borderBottom: '1px solid currentColor',
                paddingBottom: 2,
                display: 'inline-block',
              }}
            >
              View our work →
            </a>
            <a
              href="#"
              style={{
                fontSize: 14,
                color: t.sub,
                textDecoration: 'none',
                display: 'inline-block',
                marginTop: 4,
              }}
            >
              About the studio
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, {
  HeroCenteredCTA,
  HeroLeftAlignedImage,
  HeroSplitScreen,
  HeroVideoBg,
  HeroMinimalTypography,
});

function VariantLabel({ name }) {
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
      <VariantLabel name="HeroCenteredCTA" />
      <HeroCenteredCTA tokens={tokens} />
      <VariantLabel name="HeroLeftAlignedImage" />
      <HeroLeftAlignedImage />
      <VariantLabel name="HeroSplitScreen" />
      <HeroSplitScreen />
      <VariantLabel name="HeroVideoBg" />
      <HeroVideoBg />
      <VariantLabel name="HeroMinimalTypography" />
      <HeroMinimalTypography />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
