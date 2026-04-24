// when_to_use: 16:9 pitch / keynote slides. Four variants: editorial title slide,
// section divider with chapter number, two-column body with visual, and big-number
// stat slide. Pick whichever frame fits the slide; copy its function into your
// artifact and swap the copy. Page number strip auto-renders.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#CC785C',
  bg: '#faf8f3',
  ink: '#1a1a1a',
  muted: '#6b6258',
  rule: '#e6dfd1',
} /*EDITMODE-END*/;

const SERIF = "'Fraunces', 'DM Serif Display', Georgia, serif";
const SANS = "'DM Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function SlideShell({ children, n, total, eyebrow, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '16 / 9',
        background: t.bg,
        color: t.ink,
        padding: '56px 72px',
        position: 'relative',
        fontFamily: SANS,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        borderRadius: 6,
      }}
    >
      {eyebrow && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: t.accent,
            fontWeight: 500,
          }}
        >
          <span style={{ width: 24, height: 1, background: t.accent }} />
          {eyebrow}
        </div>
      )}
      {children}
      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: 72,
          right: 72,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 11,
          color: t.muted,
          fontFamily: MONO,
          fontFeatureSettings: "'tnum'",
        }}
      >
        <span>
          {String(n).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <span style={{ flex: 1, height: 1, background: t.rule, margin: '0 16px' }} />
        <span style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: SANS }}>
          Q2 · 2026
        </span>
      </div>
    </div>
  );
}

function SlideTitle({ title, subtitle, presenter, n, total, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <SlideShell n={n} total={total} eyebrow="Keynote" tokens={tokens}>
      <div style={{ marginTop: 80, maxWidth: 880 }}>
        <h1
          style={{
            fontFamily: SERIF,
            fontSize: 84,
            lineHeight: 1.02,
            fontWeight: 400,
            letterSpacing: -2,
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{ fontSize: 22, color: t.muted, marginTop: 24, lineHeight: 1.4, maxWidth: 640 }}
          >
            {subtitle}
          </p>
        )}
        {presenter && (
          <div style={{ marginTop: 64, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: t.accent }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{presenter.name}</div>
              <div style={{ fontSize: 12, color: t.muted }}>{presenter.role}</div>
            </div>
          </div>
        )}
      </div>
    </SlideShell>
  );
}

function SlideSection({ chapter, label, title, n, total, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <SlideShell n={n} total={total} tokens={tokens}>
      <div
        style={{
          marginTop: 60,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 48,
          alignItems: 'baseline',
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 140,
            color: t.accent,
            lineHeight: 0.9,
            fontFeatureSettings: "'tnum'",
          }}
        >
          {String(chapter).padStart(2, '0')}
        </div>
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: t.muted,
              marginBottom: 12,
            }}
          >
            {label}
          </div>
          <h2
            style={{
              fontFamily: SERIF,
              fontSize: 56,
              lineHeight: 1.05,
              fontWeight: 400,
              fontStyle: 'italic',
              letterSpacing: -1,
              margin: 0,
            }}
          >
            {title}
          </h2>
        </div>
      </div>
    </SlideShell>
  );
}

function SlideTwoCol({ title, points, visual, n, total, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <SlideShell n={n} total={total} eyebrow="The argument" tokens={tokens}>
      <div
        style={{
          marginTop: 32,
          display: 'grid',
          gridTemplateColumns: '1.1fr 1fr',
          gap: 56,
          alignItems: 'start',
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: SERIF,
              fontSize: 44,
              lineHeight: 1.1,
              fontWeight: 400,
              letterSpacing: -1,
              margin: '0 0 32px',
            }}
          >
            {title}
          </h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            {points.map((p, i) => (
              <li
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr',
                  gap: 16,
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: t.ink,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    color: t.accent,
                    paddingTop: 4,
                    fontFeatureSettings: "'tnum'",
                  }}
                >
                  0{i + 1}
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div
          style={{
            aspectRatio: '4/3',
            background: `linear-gradient(135deg, ${t.accent}18, ${t.accent}05)`,
            borderRadius: 12,
            border: `1px solid ${t.rule}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: t.muted,
            fontSize: 13,
          }}
        >
          {visual ?? 'Diagram or screenshot'}
        </div>
      </div>
    </SlideShell>
  );
}

function SlideStat({ stat, unit, caption, source, n, total, tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <SlideShell n={n} total={total} eyebrow="One number" tokens={tokens}>
      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 200,
              lineHeight: 1,
              letterSpacing: -6,
              color: t.ink,
              fontFeatureSettings: "'tnum'",
            }}
          >
            {stat}
          </span>
          {unit && (
            <span style={{ fontFamily: SANS, fontSize: 36, color: t.accent, fontWeight: 500 }}>
              {unit}
            </span>
          )}
        </div>
        <p
          style={{
            fontFamily: SERIF,
            fontSize: 24,
            color: t.ink,
            margin: '24px auto 0',
            maxWidth: 620,
            lineHeight: 1.4,
            fontStyle: 'italic',
          }}
        >
          {caption}
        </p>
        {source && (
          <div
            style={{
              marginTop: 20,
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: t.muted,
            }}
          >
            Source: {source}
          </div>
        )}
      </div>
    </SlideShell>
  );
}

Object.assign(window, { SlideTitle, SlideSection, SlideTwoCol, SlideStat });

function App() {
  const slides = [
    <SlideTitle
      key="t"
      n={1}
      total={4}
      title="The slow practice of seeing."
      subtitle="A field report on craft, calm, and the things that take time."
      presenter={{ name: 'Aria Chen', role: 'Design Lead, Field Studio' }}
    />,
    <SlideSection
      key="s"
      n={2}
      total={4}
      chapter={1}
      label="Chapter 01"
      title="Where we are today."
    />,
    <SlideTwoCol
      key="2"
      n={3}
      total={4}
      title="The new shape of the workflow."
      points={[
        'Designers spend 40% less time on handoff once tokens live in code.',
        'Single source of truth means dev review focuses on intent, not pixels.',
        'Iterations compress from days into hours when the system holds.',
      ]}
      visual="Workflow diagram"
    />,
    <SlideStat
      key="x"
      n={4}
      total={4}
      stat="3.2"
      unit="× faster"
      caption="Teams shipping production work after adopting the integrated design system."
      source="Internal study, n=24 teams"
    />,
  ];
  return (
    <div
      style={{
        minHeight: '100%',
        padding: 40,
        background: '#ece8df',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: SANS,
      }}
    >
      {slides}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
