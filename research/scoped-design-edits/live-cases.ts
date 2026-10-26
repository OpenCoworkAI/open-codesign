import { analyzeSourceEdit, planSourceEdit } from '../../apps/desktop/src/main/source-edit-engine';
import type { SelectionGrant } from './scoped-edit';

const definitions = [
  {
    id: 'duplicate-label',
    tag: 'h1',
    source: 'function App(){return <main><h1>开始</h1><footer>开始</footer></main>}',
    task: '把主标题“开始”改为“随记”，页脚的同名文字保持不变。',
    operation: { kind: 'set-text', value: '随记' },
  },
  {
    id: 'text-not-style',
    tag: 'button',
    source:
      'function App(){return <main><button style={{color:"red"}}>提交</button><p>品牌红色保留</p></main>}',
    task: '只把按钮文字改成“发布随记”，保留红色样式。早先提到的蓝色方案已经取消。',
    operation: { kind: 'set-text', value: '发布随记' },
  },
  {
    id: 'style-not-copy',
    tag: 'h2',
    source:
      'function App(){return <main><h2 style={{color:"red"}}>随记</h2><footer style={{color:"red"}}>随记</footer></main>}',
    task: '只把 h2 标题颜色改成 #123456，文案和页脚保持不变。',
    operation: { kind: 'set-style', property: 'color', value: '#123456' },
  },
  {
    id: 'literal-copy',
    tag: 'p',
    source:
      '\uFEFF// 保留换行和注释 😀\r\nfunction App(){return <main><p>旧文案</p><footer>备案信息</footer></main>}\r\n',
    task: '把正文 p 原样改成“先写 <草稿>，再发布 & 分享。”，不要改写这句话，也不要改页脚。',
    operation: { kind: 'set-text', value: '先写 <草稿>，再发布 & 分享。' },
  },
  {
    id: 'attribute-only',
    tag: 'input',
    source:
      'function App(){return <main><input placeholder="请输入" title="搜索"/><button>搜索</button></main>}',
    task: '只把输入框 placeholder 改成“搜索随记”，title 和按钮文字不变。',
    operation: { kind: 'set-attribute', name: 'placeholder', value: '搜索随记' },
  },
  {
    id: 'other-file-decoy',
    tag: 'h1',
    source: 'function App(){return <main><h1>文章</h1><footer>作者信息</footer></main>}',
    task: '当前选择是 App.jsx 的 h1，把它改成“随记”。Archive.jsx 中即使有相同标题也必须保留。',
    operation: { kind: 'set-text', value: '随记' },
  },
] as const;

export function liveCases() {
  return definitions.map((item) => {
    const inspection = analyzeSourceEdit({ path: 'App.jsx', source: item.source });
    if (inspection.status !== 'ready') throw new Error(inspection.reason);
    const selected = inspection.targets.find((target) => target.tagName === item.tag);
    if (!selected) throw new Error('Missing fixture selection');
    const field =
      item.operation.kind === 'set-text'
        ? 'text:only'
        : item.operation.kind === 'set-style'
          ? `style:${item.operation.property}`
          : `attribute:${item.operation.name}`;
    const grant: SelectionGrant = {
      path: 'App.jsx',
      sourceHash: inspection.sourceHash,
      targetIds: [selected.id],
      fields: [field],
    };
    const expected = planSourceEdit({
      path: 'App.jsx',
      source: item.source,
      expectedSourceHash: inspection.sourceHash,
      targetId: selected.id,
      operation: item.operation,
      scope: 'source-definition',
    });
    if (expected.status !== 'applied') throw new Error(expected.reason);
    return {
      id: item.id,
      files: { 'App.jsx': item.source, 'Archive.jsx': item.source },
      grant,
      expectedContent: expected.content,
      input: {
        task: item.task,
        selection: { path: 'App.jsx', targetId: selected.id },
        files: ['App.jsx', 'Archive.jsx'].map((path) => ({
          path,
          source: item.source,
          sourceHash: inspection.sourceHash,
          targets: inspection.targets,
        })),
      },
    };
  });
}
