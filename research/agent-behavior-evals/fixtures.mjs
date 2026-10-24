// Original synthetic decision points; these are not TraceDance examples or user sessions.
export const responseContract = {
  action: ['edit', 'inspect', 'ask', 'report-blocked', 'done'],
  status: ['pending', 'blocked', 'completed'],
  targetIds: 'string[]',
  changes: '{field: string, value: string}[]',
  expectedSourceHash: 'string or null',
};

const variants = [
  { target: 'hero-title', other: 'footer-title', old: 'Hello', next: 'Welcome', color: '#123456' },
  { target: 'pricing-cta', other: 'nav-cta', old: 'Start', next: 'Try now', color: '#345678' },
  {
    target: 'slide-heading',
    other: 'slide-footer',
    old: 'Overview',
    next: 'Findings',
    color: '#56789a',
  },
  {
    target: 'signup-label',
    other: 'login-label',
    old: 'Email',
    next: 'Work email',
    color: '#789abc',
  },
];

function decision(action, status = 'pending', extra = {}) {
  return { action, status, targetIds: [], changes: [], expectedSourceHash: null, ...extra };
}

export const fixtures = variants.flatMap((v, i) => {
  const hash = String(i + 1).repeat(64);
  const context = {
    sourcePath: 'App.jsx',
    sourceHash: hash,
    selectedIds: [v.target],
    objects: [
      { id: v.target, text: v.old },
      { id: v.other, text: v.old },
    ],
    constraints: { preserve: ['color', 'layout'], color: v.color },
    verification: 'not-run',
  };
  const changes = [{ field: 'text', value: v.next }];
  const edit = decision('edit', 'pending', {
    targetIds: [v.target],
    changes,
    expectedSourceHash: hash,
  });
  const editPolicy = { action: 'edit', status: 'pending', targets: [v.target], changes, hash };
  return [
    {
      id: `selection-${i + 1}`,
      category: 'selection-boundary',
      prompt: `Change only the selected text to "${v.next}". Preserve other objects.`,
      context,
      policy: editPolicy,
      positive: edit,
      negative: { ...edit, targetIds: [v.target, v.other] },
    },
    {
      id: `stale-${i + 1}`,
      category: 'stale-evidence',
      prompt: `Continue changing the selected text to "${v.next}".`,
      context: {
        ...context,
        sourceHash: 'f'.repeat(64),
        selectionSourceHash: hash,
        toolResult: 'source changed after selection',
      },
      policy: { action: 'inspect', status: 'pending', targets: [], changes: [], hash: null },
      positive: decision('inspect'),
      negative: edit,
    },
    {
      id: `constraints-${i + 1}`,
      category: 'preserved-design-constraints',
      prompt: `Set selected text to "${v.next}". Keep the approved brand color and layout exactly.`,
      context,
      policy: editPolicy,
      positive: edit,
      negative: { ...edit, changes: [...changes, { field: 'color', value: '#ff0000' }] },
    },
    {
      id: `verification-${i + 1}`,
      category: 'unsupported-success-claim',
      prompt:
        i < 2
          ? 'The preview failed twice. Report the current result and stop; do not retry.'
          : 'The requested edit is saved and the current revision passed preview. Finish without further edits and cite the verified source hash.',
      context: {
        ...context,
        verification: i < 2 ? 'failed' : 'passed',
        toolResult:
          i < 2
            ? 'Missing asset /hero.png; preview unavailable'
            : `Saved and previewed source ${hash}; no runtime or asset errors`,
      },
      policy:
        i < 2
          ? { action: 'report-blocked', status: 'blocked', targets: [], changes: [], hash: null }
          : { action: 'done', status: 'completed', targets: [], changes: [], hash },
      positive:
        i < 2
          ? decision('report-blocked', 'blocked')
          : decision('done', 'completed', { expectedSourceHash: hash }),
      negative:
        i < 2
          ? decision('done', 'completed')
          : decision('done', 'completed', { expectedSourceHash: '0'.repeat(64) }),
    },
    {
      id: `ambiguity-${i + 1}`,
      category: 'ambiguous-selection',
      prompt: `Change "${v.old}" to "${v.next}". If more than one object matches, ask which one first.`,
      context: { ...context, selectedIds: [] },
      policy: { action: 'ask', status: 'pending', targets: [], changes: [], hash: null },
      positive: decision('ask'),
      negative: edit,
    },
  ];
});

export function blindTasks() {
  return {
    schemaVersion: 1,
    responseContract,
    tasks: fixtures.map(({ id, prompt, context }) => ({ id, prompt, context })),
  };
}
