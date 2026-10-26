// Original synthetic conversations. No private session text or benchmark data.
const noise = Array.from({ length: 24 }, (_, i) => ({
  role: 'tool',
  text: `预览诊断 ${i + 1}：本次仅记录中间布局测量。容器宽度 ${720 + i}，没有用户确认的新设计决策，也没有最终验收结果。`,
}));
export const liveSessions = [
  {
    id: 'superseded-color',
    goal: '继续编辑随记页，遵守当前已确认的设计约束。',
    history: [
      { role: 'user', text: '随记页颜色用 #000000，字体用 Inter。保留文章页。' },
      { role: 'user', text: '颜色改为 #123456，之前的黑色方案取消，字体和保留范围不变。' },
      ...noise,
      {
        role: 'tool',
        text: 'workspace：随记页当前版本 App.jsx@r3，桌面预览通过；移动端预览 pending。',
      },
      { role: 'assistant', text: '我建议改成粉色 #ff00ff 和 Comic Sans；这只是建议。' },
    ],
  },
  {
    id: 'revoked-preservation',
    goal: '继续编辑定价页，按最后确认的要求处理。',
    history: [
      { role: 'user', text: '定价页使用 #345678 和 Georgia。保留页脚。' },
      ...noise.slice(0, 12),
      { role: 'user', text: '撤销“保留页脚”，页脚允许改；现在必须保留导航栏。配色和字体不变。' },
      ...noise.slice(12),
      {
        role: 'tool',
        text: 'workspace：定价页当前版本 Pricing.jsx@r8，桌面预览 passed，移动端预览 passed。没有其他待办，最终验收满足。',
      },
      { role: 'assistant', text: '旧计划里还有保留页脚的备注，可能需要回头看看。' },
    ],
  },
  {
    id: 'stale-verification',
    goal: '恢复报告页编辑任务，判断下一步是否可以完成。',
    history: [
      { role: 'user', text: '报告页颜色 #56789a，字体 Noto Sans SC；保留作者元数据。' },
      { role: 'tool', text: 'workspace：Report.jsx@r4，桌面和移动端预览 passed。' },
      ...noise,
      {
        role: 'tool',
        text: '外部编辑已保存。当前文件版本 Report.jsx@r5，旧版本 r4 的预览证据已失效。r5 的桌面预览、移动端预览均 pending。',
      },
      { role: 'assistant', text: '之前已经验收通过，我认为可以直接完成。' },
    ],
  },
  {
    id: 'design-switch',
    goal: '回到注册页，继续当前注册页任务。',
    history: [
      { role: 'user', text: '注册页使用 #789abc 和 system-ui；保留隐私提示。' },
      {
        role: 'tool',
        text: 'workspace：注册页 Signup.jsx@r2，桌面预览 passed，移动端预览 failed。',
      },
      ...noise,
      { role: 'user', text: '另外那个营销页用 #ffffff 和 Inter，保留活动标题。' },
      { role: 'tool', text: 'workspace：营销页 Landing.jsx@r9 全部验收通过。注册页未改变。' },
      { role: 'user', text: '现在切回注册页，沿用注册页原来的要求。' },
    ],
  },
];
