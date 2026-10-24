// Evaluator-only references. Compressors must not import this module.
export const questions = [
  ['session-1', '#123456', 'Inter', 'neon', 'App.jsx@r3'],
  ['session-2', '#345678', 'Noto Sans SC', 'glass', 'Deck.jsx@r8'],
  ['session-3', '#56789a', 'Georgia', 'gradient', 'Pricing.jsx@r2'],
  ['session-4', '#789abc', 'system-ui', 'retro', 'Signup.jsx@r6'],
  ['session-5', '#901234', 'Roboto', 'skeuomorphic', 'Dashboard.jsx@r5'],
  ['session-6', '#234567', 'Source Han Sans', 'comic', 'Report.jsx@r4'],
].flatMap(([sessionId, color, font, rejectedStyle, revision]) => [
  {
    sessionId,
    key: 'brandColor',
    text: 'Which approved brand color must the next edit preserve?',
    answer: color,
  },
  { sessionId, key: 'fontFamily', text: 'Which font is approved?', answer: font },
  {
    sessionId,
    key: 'rejectedStyle',
    text: 'Which rejected visual style must not be revived?',
    answer: rejectedStyle,
  },
  {
    sessionId,
    key: 'revision',
    text: 'Which current workspace revision must be used?',
    answer: revision,
  },
]);
