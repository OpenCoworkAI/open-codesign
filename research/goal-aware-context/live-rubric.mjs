// Evaluator-only labels. Neither compressor nor reader receives this module's data.
export const expectedAnswers = {
  'superseded-color': {
    color: '#123456',
    font: 'Inter',
    preserve: '文章页',
    revision: 'App.jsx@r3',
    nextAction: 'inspect',
    remainingChecks: ['mobile'],
  },
  'revoked-preservation': {
    color: '#345678',
    font: 'Georgia',
    preserve: '导航栏',
    revision: 'Pricing.jsx@r8',
    nextAction: 'done',
    remainingChecks: [],
  },
  'stale-verification': {
    color: '#56789a',
    font: 'Noto Sans SC',
    preserve: '作者元数据',
    revision: 'Report.jsx@r5',
    nextAction: 'inspect',
    remainingChecks: ['desktop', 'mobile'],
  },
  'design-switch': {
    color: '#789abc',
    font: 'system-ui',
    preserve: '隐私提示',
    revision: 'Signup.jsx@r2',
    nextAction: 'inspect',
    remainingChecks: ['mobile'],
  },
};
export const answerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['color', 'font', 'preserve', 'revision', 'nextAction', 'remainingChecks'],
  properties: {
    color: { type: 'string' },
    font: { type: 'string' },
    preserve: { type: 'string' },
    revision: { type: 'string' },
    nextAction: { type: 'string', enum: ['inspect', 'done'] },
    remainingChecks: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile'] } },
  },
};
export function scoreAnswer(id, value) {
  const expected = expectedAnswers[id];
  const keys = Object.keys(expected);
  const valid =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) =>
      key === 'remainingChecks'
        ? Array.isArray(value[key]) &&
          value[key].every((v) => ['desktop', 'mobile'].includes(v)) &&
          new Set(value[key]).size === value[key].length
        : typeof value[key] === 'string',
    ) &&
    ['inspect', 'done'].includes(value.nextAction);
  const fields = keys.map((key) => ({
    key,
    correct: Boolean(
      valid &&
        (key === 'remainingChecks'
          ? JSON.stringify([...value[key]].sort()) === JSON.stringify([...expected[key]].sort())
          : value[key] === expected[key]),
    ),
  }));
  return {
    valid,
    correctFields: fields.filter((f) => f.correct).length,
    allCorrect: fields.every((f) => f.correct),
    fields,
  };
}
