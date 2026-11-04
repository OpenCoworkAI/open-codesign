import {
  type StateEvent,
  type StateReference,
  validateStateReference,
} from './state-evaluation.js';

export interface StateTrajectory {
  id: string;
  family: string;
  goal: string;
  annotationStatus: 'synthetic-user-reviewed';
  events: StateEvent[];
  checkpoints: StateReference[];
}
const scope = (
  designId: string | null,
  field: string,
  revision: string | null = null,
  objectId: string | null = null,
) => ({
  workspaceId: 'w',
  designId,
  file: designId === null ? null : 'App.jsx',
  objectId,
  field,
  revision,
});
type Expected = StateReference['claims'][number];
function event(
  seq: number,
  authority: StateEvent['authority'],
  text: string,
  revision: string | null = null,
  designId = 'A',
): StateEvent {
  return { id: `e${seq}`, seq, authority, designId, revision, text };
}
function expected(
  events: StateEvent[],
  key: string,
  kind: Expected['kind'],
  value: string | string[],
  target: Expected['scope'],
  sources: number[],
  rules: Expected['invalidation']['rules'],
  status: Expected['invalidation']['status'] = 'active',
): Expected {
  return {
    key,
    kind,
    acceptedValues: typeof value === 'string' ? [value] : value,
    acceptedSourceSets: [],
    scope: target,
    sources: sources.map((seq) => {
      const source = events.find((e) => e.seq === seq);
      if (!source) throw new Error('Missing fixture evidence');
      return { eventId: source.id, seq, authority: source.authority, revision: source.revision };
    }),
    invalidation: { status, rules },
  };
}
function trajectory(
  id: string,
  family: string,
  events: StateEvent[],
  claimsAt: (cutoff: number) => Expected[],
): StateTrajectory {
  return {
    id,
    family,
    goal: '接续当前设计，保留有效要求并如实描述当前文件与未完成工作。',
    annotationStatus: 'synthetic-user-reviewed',
    events,
    checkpoints: [1, 3, 5].map((cutoff) =>
      validateStateReference({
        cutoff,
        events: events.filter((e) => e.seq <= cutoff),
        claims: claimsAt(cutoff),
      }),
    ),
  };
}

export function stateStressFixtures(): StateTrajectory[] {
  const versions = [
    event(0, 'user', 'workspace w / design A / App.jsx / button：我批准按钮颜色 #2463A6。'),
    event(1, 'tool', 'read App.jsx: revision r1, button color #2463A6; preview r1 passed.', 'r1'),
    event(2, 'user', '接下来只修改标题，用户批准色继续有效。'),
    event(
      3,
      'tool',
      'external editor changed App.jsx; read: current revision r2, button color #317245. No preview of r2 exists.',
      'r2',
    ),
    event(4, 'user', '只改标题文案。磁盘颜色差异先报告，不要自行改回去。'),
    event(5, 'user', '我尚未批准改变按钮色，也尚未决定怎样处理磁盘差异。'),
  ];
  const recovery = [
    event(0, 'user', 'workspace w / design A / App.jsx：保留顶栏和 fontSize，只修复空状态。'),
    event(1, 'tool', 'preview App.jsx revision r1 passed.', 'r1'),
    event(2, 'tool', 'write empty-state-copy created App.jsx r2; preview r2 timed out.', 'r2'),
    event(
      3,
      'user',
      '预览失败不算通过。下一动作必须先重读 App.jsx，再重试预览；不能沿用 r1 成功。',
    ),
    event(4, 'user', '先恢复预览，顶栏和字号限制继续有效。'),
    event(5, 'tool', 'No further read or preview receipt has been produced.', 'r2'),
  ];
  const correction = (newDesign: boolean) => [
    event(
      0,
      'user',
      'workspace w 全局限制：所有设计禁止动画，animations=disabled，切换设计后也继续有效。',
    ),
    event(1, 'user', 'design A / App.jsx 的 font 为 Inter；这是 A 的局部约定。'),
    event(2, 'user', '纠正 A 的字体为 Georgia，替代 Inter；作用域仍只有 A。'),
    event(3, 'user', '记录当前修正；下一步继续做文案工作。'),
    event(
      4,
      'user',
      newDesign
        ? '切换到 design B / App.jsx。B 字体尚未决定，先问我，不要复用 A 的字体。'
        : '继续 design A / App.jsx，同一设计内已确认的字体决定继续适用。',
      null,
      newDesign ? 'B' : 'A',
    ),
    event(5, 'user', '本轮只准备文案，没有新的字体批准。', null, newDesign ? 'B' : 'A'),
  ];
  const fixtures = [
    trajectory('version-facts', 'external-version', versions, (cutoff) => [
      expected(
        versions,
        'approvedColor',
        'intent',
        '#2463A6',
        scope('A', 'color', null, 'button'),
        [0],
        ['explicit-user-change', 'scope-change'],
      ),
      expected(
        versions,
        'diskColor',
        'artifact-fact',
        cutoff === 1 ? '#2463A6' : '#317245',
        scope('A', 'color', cutoff === 1 ? 'r1' : 'r2', 'button'),
        [cutoff === 1 ? 1 : 3],
        ['new-observation'],
      ),
      expected(
        versions,
        'r1Preview',
        'verification',
        'passed',
        scope('A', 'preview', 'r1'),
        cutoff === 1 ? [1] : [1, 3],
        ['revision-change'],
        cutoff === 1 ? 'active' : 'stale',
      ),
    ]),
    trajectory('recovery-action', 'failed-preview', recovery, (cutoff) => [
      expected(
        recovery,
        'fontSize',
        'intent',
        'preserve',
        scope('A', 'fontSize'),
        [0],
        ['explicit-user-change', 'scope-change'],
      ),
      expected(
        recovery,
        'nextAction',
        'obligation',
        cutoff === 1
          ? ['修复空状态', '只修复空状态', 'fix-empty-state']
          : ['read:App.jsx', '重读 App.jsx', '重读App.jsx', '先重读 App.jsx', 'reread-App.jsx'],
        scope('A', 'nextAction'),
        [cutoff === 1 ? 0 : 3],
        ['until-completed', 'explicit-user-change'],
      ),
    ]),
    ...[false, true].map((newDesign) => {
      const events = correction(newDesign);
      return trajectory(
        newDesign ? 'correction-new-design' : 'correction-same-design',
        'font-correction-pair',
        events,
        (cutoff) => [
          expected(
            events,
            'animations',
            'intent',
            'disabled',
            scope(null, 'animations'),
            [0],
            ['explicit-user-change'],
          ),
          expected(
            events,
            'font',
            'intent',
            cutoff === 1 ? 'Inter' : newDesign && cutoff === 5 ? 'unresolved' : 'Georgia',
            scope(newDesign && cutoff === 5 ? 'B' : 'A', 'font'),
            [cutoff === 1 ? 1 : newDesign && cutoff === 5 ? 4 : 2],
            ['explicit-user-change', 'scope-change'],
            newDesign && cutoff === 5 ? 'unresolved' : 'active',
          ),
        ],
      );
    }),
  ];
  for (const fixture of fixtures) {
    for (const checkpoint of fixture.checkpoints) {
      for (const claim of checkpoint.claims) {
        const additions =
          claim.key === 'fontSize'
            ? ['保持不变', '保留字号']
            : claim.key === 'animations'
              ? ['禁止动画', '禁用动画']
              : claim.key === 'font' && claim.invalidation.status === 'unresolved'
                ? ['尚未决定', '待确认']
                : claim.key === 'nextAction' && checkpoint.cutoff > 1
                  ? ['先重读App.jsx']
                  : [];
        claim.acceptedValues = [...new Set([...claim.acceptedValues, ...additions])];
        let optional: number[] = [];
        if (fixture.id === 'version-facts' && claim.key === 'approvedColor') optional = [2, 5];
        else if (fixture.id === 'recovery-action' && claim.key === 'fontSize') optional = [4];
        else if (
          fixture.id === 'recovery-action' &&
          claim.key === 'nextAction' &&
          checkpoint.cutoff > 1
        )
          optional = [5];
        else if (
          fixture.id === 'correction-same-design' &&
          claim.key === 'font' &&
          checkpoint.cutoff === 5
        )
          optional = [4, 5];
        else if (
          fixture.id === 'correction-new-design' &&
          claim.key === 'font' &&
          checkpoint.cutoff === 5
        )
          optional = [5];
        const supports = checkpoint.events.filter((event) => optional.includes(event.seq));
        for (let mask = 1; mask < 2 ** supports.length; mask++) {
          claim.acceptedSourceSets.push([
            ...claim.sources,
            ...supports
              .filter((_, index) => (mask & (1 << index)) !== 0)
              .map((event) => ({
                eventId: event.id,
                seq: event.seq,
                authority: event.authority,
                revision: event.revision,
              })),
          ]);
        }
      }
      validateStateReference(checkpoint);
    }
  }
  return structuredClone(fixtures);
}
