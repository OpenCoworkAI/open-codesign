// Synthetic structured events, not raw pi sessions or any published benchmark dataset.
function event(scope, key, value, source = 'user', accepted = true) {
  return { scope, key, value, source, accepted };
}

const designs = [
  ['landing', '#123456', 'Inter', 'neon', 'App.jsx@r3'],
  ['deck', '#345678', 'Noto Sans SC', 'glass', 'Deck.jsx@r8'],
  ['pricing', '#56789a', 'Georgia', 'gradient', 'Pricing.jsx@r2'],
  ['signup', '#789abc', 'system-ui', 'retro', 'Signup.jsx@r6'],
  ['dashboard', '#901234', 'Roboto', 'skeuomorphic', 'Dashboard.jsx@r5'],
  ['report', '#234567', 'Source Han Sans', 'comic', 'Report.jsx@r4'],
];

export const sessions = designs.map(([scope, color, font, rejectedStyle, revision], index) => {
  const fixed = [
    event(scope, 'brandColor', color),
    event(scope, 'fontFamily', font),
    event(scope, 'rejectedStyle', rejectedStyle),
    event(scope, 'revision', revision, 'workspace'),
  ];
  const noise = Array.from({ length: 32 }, (_, i) =>
    event(
      i % 2 ? 'other-design' : scope,
      `observation-${i}`,
      `Preview diagnostic ${i}: synthetic intermediate measurements and draft notes, no accepted constraint change.`,
      'tool',
    ),
  );
  const old = [
    event(scope, 'brandColor', '#000000'),
    event(scope, 'revision', 'App.jsx@r1', 'workspace'),
  ];
  const proposals = [
    event(scope, 'brandColor', '#ff00ff', 'assistant', false),
    event(scope, 'fontFamily', 'Comic Sans', 'tool', true),
    event('other-design', 'brandColor', '#ffffff'),
  ];
  const history =
    index % 3 === 0
      ? [...old, ...fixed, ...noise, ...proposals]
      : index % 3 === 1
        ? [...old, ...fixed.slice(0, 2), ...noise, ...fixed.slice(2), ...proposals]
        : [...old, ...noise, ...fixed, ...proposals];
  return {
    id: `session-${index + 1}`,
    goal: {
      scope,
      text: `Continue editing ${scope} while respecting approved design decisions and the latest workspace revision.`,
    },
    history,
  };
});
