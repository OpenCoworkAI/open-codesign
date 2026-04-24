// when_to_use: Editorial / long-form layout. Magazine-style typography for
// essays, journals, op-eds. Three variants: classical essay (drop cap, single
// column, pull quote), magazine spread (asymmetric two-column with sidebar),
// and minimal poetry layout (centered, generous whitespace, italic display).
// Numerical figures (read time, dates, page numbers) render in DM Sans /
// JetBrains Mono — never italic serif.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#8B0000',
  bg: '#fbf8f3',
  ink: '#1a1a1a',
  muted: '#6b6258',
  rule: '#e2dccd',
} /*EDITMODE-END*/;

const SERIF = "'Fraunces', 'DM Serif Display', Georgia, serif";
const SANS = "'DM Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const NUM = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: "'tnum'",
  fontStyle: 'normal',
};

function EssayClassical({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens };
  return (
    <article
      style={{
        background: t.bg,
        color: t.ink,
        fontFamily: SERIF,
        padding: '64px 80px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <header style={{ marginBottom: 40, paddingBottom: 28, borderBottom: `1px solid ${t.rule}` }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: t.accent,
            marginBottom: 16,
          }}
        >
          Volume <span style={{ ...NUM, fontFamily: MONO }}>03</span> · Essay
        </div>
        <h1
          style={{
            fontSize: 64,
            lineHeight: 1.05,
            fontWeight: 400,
            margin: '0 0 24px',
            letterSpacing: -1.5,
          }}
        >
          The slow practice <span style={{ fontStyle: 'italic' }}>of seeing</span>.
        </h1>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            color: t.muted,
            display: 'flex',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <span>By Aria Chen</span>
          <span style={{ width: 4, height: 4, background: t.muted, borderRadius: '50%' }} />
          <span style={{ ...NUM }}>12 min read</span>
          <span style={{ width: 4, height: 4, background: t.muted, borderRadius: '50%' }} />
          <span style={{ ...NUM }}>April 2026</span>
        </div>
      </header>
      <p style={{ fontSize: 19, lineHeight: 1.7, margin: '0 0 22px' }}>
        <span
          style={{
            float: 'left',
            fontSize: 86,
            lineHeight: 0.85,
            paddingRight: 14,
            paddingTop: 8,
            fontWeight: 500,
            color: t.accent,
            fontFamily: SERIF,
          }}
        >
          T
        </span>
        he opening paragraph carries the weight of the whole piece. Set the scene with a concrete
        image — the cracked enamel of the cup, the grain in the table — and let the reader settle
        into the rhythm before you make any demands.
      </p>
      <p style={{ fontSize: 19, lineHeight: 1.7, margin: '0 0 22px' }}>
        Subsequent paragraphs vary in length to keep the eye engaged. A short sentence, deployed at
        the right moment, can do the work of three. Restraint is the posture; clarity, the pursuit.
      </p>
      <blockquote
        style={{
          borderLeft: `3px solid ${t.accent}`,
          paddingLeft: 28,
          margin: '36px 0',
          fontStyle: 'italic',
          fontSize: 26,
          lineHeight: 1.4,
          color: '#444',
        }}
      >
        "Typography is what language looks like." — Ellen Lupton
      </blockquote>
      <p style={{ fontSize: 19, lineHeight: 1.7, margin: 0 }}>
        Close on a line that earns the white space below it. The reader should feel the page settle
        around the period.
      </p>
    </article>
  );
}

function MagazineSpread({ tokens = {} }) {
  const t = { ...TWEAK_DEFAULTS, ...tokens, bg: '#fffefb' };
  return (
    <article
      style={{
        background: t.bg,
        color: t.ink,
        fontFamily: SERIF,
        padding: '56px 64px',
        maxWidth: 1080,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: `2px solid ${t.ink}`,
          paddingBottom: 16,
          marginBottom: 40,
          fontFamily: SANS,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: t.muted,
        }}
      >
        <span>The Field Review</span>
        <span style={{ ...NUM, fontFamily: MONO }}>Issue 04 · April 2026</span>
        <span>
          p. <span style={{ ...NUM, fontFamily: MONO }}>22</span>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 56 }}>
        <div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: t.accent,
              marginBottom: 16,
            }}
          >
            Profile
          </div>
          <h1
            style={{
              fontSize: 56,
              lineHeight: 1.04,
              fontWeight: 400,
              margin: '0 0 32px',
              letterSpacing: -1,
              fontStyle: 'italic',
            }}
          >
            What the woodturner knows.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.7,
              margin: '0 0 18px',
              columnCount: 2,
              columnGap: 32,
            }}
          >
            For thirty-one years, Aria Chen has worked the same lathe in the same shed at the bottom
            of her garden in Devon. The shavings, she says, tell her when the cut is right. Light,
            bright, almost translucent — that is wood that wants to be made into something. Heavy,
            dark, smelling of resin — that is wood that needs another season.
          </p>
          <p style={{ fontSize: 17, lineHeight: 1.7, margin: 0, columnCount: 2, columnGap: 32 }}>
            The shop is not large. A shelf of unfinished bowls. A row of chisels, oiled and arranged
            by sweep. A kettle, always on. "I have stopped trying to teach what I do," she tells me,
            halfway through her second mug. "What I can teach is patience. The rest is just wood."
          </p>
        </div>
        <aside style={{ borderLeft: `1px solid ${t.rule}`, paddingLeft: 28 }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: t.muted,
              marginBottom: 12,
            }}
          >
            At a glance
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              fontFamily: SANS,
              fontSize: 13,
              lineHeight: 1.6,
              color: t.ink,
            }}
          >
            {[
              ['Born', '1962, Singapore'],
              ['Working since', '1995'],
              ['Studio', 'Devon, UK'],
              ['Materials', 'English ash, walnut, sycamore'],
            ].map(([k, v]) => (
              <li
                key={k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: `1px solid ${t.rule}`,
                }}
              >
                <span style={{ color: t.muted }}>{k}</span>
                <span style={{ ...(k === 'Born' || k === 'Working since' ? NUM : {}) }}>{v}</span>
              </li>
            ))}
          </ul>
          <blockquote
            style={{
              marginTop: 24,
              fontStyle: 'italic',
              fontSize: 19,
              lineHeight: 1.4,
              color: t.accent,
              fontFamily: SERIF,
            }}
          >
            "The lathe is a metronome. You don't argue with it."
          </blockquote>
        </aside>
      </div>
    </article>
  );
}

function PoetryMinimal({ tokens = {} }) {
  const t = {
    ...TWEAK_DEFAULTS,
    ...tokens,
    bg: '#1a1816',
    ink: '#f5f1ea',
    muted: 'rgba(245,241,234,0.55)',
    accent: '#d4a574',
  };
  return (
    <article
      style={{
        background: t.bg,
        color: t.ink,
        fontFamily: SERIF,
        padding: '120px 48px',
        textAlign: 'center',
        minHeight: 600,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 11,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: t.muted,
          marginBottom: 48,
        }}
      >
        From{' '}
        <span
          style={{
            fontFamily: SERIF,
            fontStyle: 'italic',
            textTransform: 'none',
            letterSpacing: 0,
            fontSize: 13,
          }}
        >
          Field Notes
        </span>
      </div>
      <div
        style={{
          maxWidth: 520,
          margin: '0 auto',
          fontSize: 22,
          lineHeight: 1.85,
          fontStyle: 'italic',
          color: t.ink,
        }}
      >
        We learned the names of the small flowers first.
        <br />
        Then the names of the birds we could hear
        <br />
        but not see. Then, slowly,
        <br />
        the names of the trees.
      </div>
      <div style={{ width: 32, height: 1, background: t.accent, margin: '56px auto' }} />
      <div
        style={{
          fontFamily: SANS,
          fontSize: 12,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: t.muted,
        }}
      >
        Aria Chen · <span style={{ fontFamily: MONO, ...NUM }}>iv · 2026</span>
      </div>
    </article>
  );
}

Object.assign(window, { EssayClassical, MagazineSpread, PoetryMinimal });

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
    <div style={{ minHeight: '100%', background: '#1a1a1a' }}>
      <Label name="EssayClassical" />
      <EssayClassical />
      <Label name="MagazineSpread" />
      <MagazineSpread />
      <Label name="PoetryMinimal" />
      <PoetryMinimal />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
