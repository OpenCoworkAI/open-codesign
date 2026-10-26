import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHostContext, type DocumentSpec } from './host-context';

export const checkpointIds = [
  'signup-ready',
  'signup-external-edit',
  'signup-partial',
  'pricing-policy-ready',
  'pricing-return',
  'pricing-pending-work',
] as const;
export type CheckpointId = (typeof checkpointIds)[number];
const documents: DocumentSpec[] = [
  {
    id: 'signup',
    file: 'Signup.jsx',
    objectId: 'signup/page',
    label: '注册页',
    children: [{ id: 'signup/privacy', label: '隐私提示' }],
  },
  {
    id: 'pricing',
    file: 'Pricing.jsx',
    objectId: 'pricing/page',
    label: '定价页',
    children: [
      { id: 'pricing/nav', label: '导航栏' },
      { id: 'pricing/footer', label: '页脚' },
    ],
  },
  {
    id: 'landing',
    file: 'Landing.jsx',
    objectId: 'landing/page',
    label: '营销页',
    children: [{ id: 'landing/header', label: '活动标题' }],
  },
];
export function replayCheckpoint(id: CheckpointId, root: string) {
  mkdirSync(root);
  for (const doc of documents)
    writeFileSync(
      path.join(root, doc.file),
      `function App(){return <main><h1>${doc.label}</h1><p>版本一</p></main>}`,
    );
  const host = createHostContext(root, documents);
  const history: { role: string; text: string }[] = [];
  const callbacks: { accepted: boolean; reason: string | null }[] = [];
  const user = (text: string) => history.push({ role: 'user', text });
  const assistant = (text: string) => history.push({ role: 'assistant', text });
  const record = (text: string) =>
    history.push({ role: 'tool', text: `${text}\n${JSON.stringify(host.snapshot())}` });
  const check = (documentId: string, name: 'desktop' | 'mobile', result: 'passed' | 'failed') => {
    const receipt = host.finishCheck(host.beginCheck(documentId, name), result);
    callbacks.push(receipt);
  };
  const noise = () => {
    for (let i = 0; i < 8; i++)
      assistant(
        `中间讨论 ${i + 1}：可以考虑调整留白和卡片间距。这只是草案，不代表用户确认，也不构成验收证据。`,
      );
  };
  let goal: { activeDesign: string; text: string };
  if (id.startsWith('signup-')) {
    goal = { activeDesign: 'signup', text: '恢复注册页，沿用已确认的目标与偏好，选择下一步。' };
    user('注册页 signup/page 使用 #123456 和 Inter。必须保留 signup/privacy（隐私提示）。');
    host.activate('signup');
    host.setPolicy('signup', {
      protectedIds: ['signup/privacy'],
      requiredChecks: ['desktop', 'mobile'],
      pendingWork: [],
    });
    check('signup', 'desktop', 'passed');
    check('signup', 'mobile', 'passed');
    record('版本一的两项验收已返回。');
    noise();
    if (id !== 'signup-ready') {
      const delayed = host.beginCheck('signup', 'mobile');
      writeFileSync(
        path.join(root, 'Signup.jsx'),
        'function App(){return <main><h1>注册页</h1><p>用户在外部保存了版本二</p></main>}',
      );
      record('检测到外部文件修改。');
      const late = host.finishCheck(delayed, 'passed');
      callbacks.push(late);
      history.push({
        role: 'tool',
        text: `版本一的移动端旧回调刚刚到达：passed。宿主处理结果：${JSON.stringify(late)}；不能计入版本二。`,
      });
      assistant('我记得刚才移动端返回通过了，似乎可以完成。');
      noise();
    }
    if (id === 'signup-partial') {
      check('signup', 'desktop', 'passed');
      const older = host.beginCheck('signup', 'mobile');
      const newest = host.beginCheck('signup', 'mobile');
      callbacks.push(host.finishCheck(newest, 'failed'));
      callbacks.push(host.finishCheck(older, 'passed'));
      record('同一版本重复检查：较新的移动端检查失败，较旧的通过回调被拒绝。');
      assistant('之前的计划上两项都是通过，是否能沿用？这不是新的验证结果。');
    }
  } else {
    goal = { activeDesign: 'pricing', text: '回到定价页，沿用最后确认的要求，选择下一步。' };
    user('定价页 pricing/page 使用 #345678 和 Georgia。先保留 pricing/footer（页脚）。');
    host.activate('pricing');
    host.setPolicy('pricing', {
      protectedIds: ['pricing/footer'],
      requiredChecks: ['desktop', 'mobile'],
      pendingWork: [],
    });
    check('pricing', 'desktop', 'passed');
    check('pricing', 'mobile', 'passed');
    record('旧要求下验收通过。');
    user('撤销保留页脚。现在允许改页脚，必须保留 pricing/nav（导航栏）。颜色和字体不变。');
    host.setPolicy('pricing', {
      protectedIds: ['pricing/nav'],
      requiredChecks: ['desktop', 'mobile'],
      pendingWork: [],
    });
    check('pricing', 'desktop', 'passed');
    check('pricing', 'mobile', 'passed');
    record('新要求重新检查，两项通过，无剩余工作。');
    noise();
    if (id !== 'pricing-policy-ready') {
      user('切到另一个设计：营销页 landing/page 改用 #ffffff、system-ui，保留 landing/header。');
      host.activate('landing');
      host.setPolicy('landing', {
        protectedIds: ['landing/header'],
        requiredChecks: ['desktop', 'mobile'],
        pendingWork: [],
      });
      check('landing', 'desktop', 'passed');
      check('landing', 'mobile', 'passed');
      record('营销页验收通过。');
      writeFileSync(
        path.join(root, 'Pricing.jsx'),
        'function App(){return <main><h1>定价页</h1><p>外部更新后的价格</p></main>}',
      );
      user('回到定价页，沿用定价页自身的颜色和字体，不要带入营销页。');
      host.activate('pricing');
      record('返回后读取磁盘，定价页已经是新版本。');
      assistant('营销页刚完成验收，可能整个任务都完成了。');
      noise();
    }
    if (id === 'pricing-pending-work') {
      check('pricing', 'desktop', 'passed');
      check('pricing', 'mobile', 'passed');
      host.setPendingWork('pricing', ['export-job']);
      record('定价页两项预览通过，但导出任务仍在排队，尚未完成。');
      assistant('两项预览既然通过了，就可以直接宣告全部完成。');
    }
  }
  return { id, goal, history, catalog: host.catalog(), host, callbacks };
}
