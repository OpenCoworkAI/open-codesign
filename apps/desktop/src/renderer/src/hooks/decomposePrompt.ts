/**
 * Decompose-trigger prompt — fired as a follow-up user message when the user
 * clicks "Decompose to UI Kit" in the chat sidebar's add menu. NOT auto-fired
 * (unlike polishPrompt.ts). Tells the agent to call decompose_to_ui_kit with
 * the structured component / token plan derived from the current artifact.
 *
 * Locale-aware in the same shape as polishPrompt.ts so tone and examples feel
 * consistent for ZH and EN users.
 */

export const DECOMPOSE_PROMPT_ZH = `把刚才那个设计拆成一个 ui_kits/<slug>/ 目录, 对齐 coding agent handoff 的形态:

1. 先用 str_replace_based_edit_tool view index.html 把当前 artifact 完整读一遍
2. 选一个简短的 slug (kebab-case, 比如 saas-dashboard)
3. 拆解:
   - index.html: 与原图视觉一致的整页 HTML
   - components/*.tsx: 重复结构抽出的组件 (出现 ≥3 次的 DOM 子树), props 用 TS 类型, 比如 \`<MetricCard label value delta trend />\`
   - tokens.css: 重复出现 ≥3 次的颜色 / 间距 / 字号 / 圆角 / 阴影抽成 CSS 变量
   - readmeNotes: 给下游 coding agent 的接入说明
4. 一次性调 decompose_to_ui_kit, 把 slug + indexHtml + components 数组 + tokens 数组 + readmeNotes 一起传过去 (不要拆成多次调用)
5. 调用完毕调 done

不要重写原 artifact, 只输出 ui_kits/ 下的新文件。`;

export const DECOMPOSE_PROMPT_EN = `Decompose the design you just produced into a ui_kits/<slug>/ folder, shaped for coding-agent handoff:

1. Use str_replace_based_edit_tool view to load index.html fully first.
2. Pick a short kebab-case slug (e.g. saas-dashboard).
3. Decompose:
   - index.html: full-page HTML visually parity-matched to the source
   - components/*.tsx: components extracted from repeated structure (DOM subtrees appearing >= 3 times), typed props like \`<MetricCard label value delta trend />\`
   - tokens.css: any color / spacing / typography / radius / shadow value used >= 3 times -> a CSS variable
   - readmeNotes: handoff notes for the downstream coding agent
4. Call decompose_to_ui_kit ONCE with slug, indexHtml, components, tokens, and readmeNotes (do NOT split across multiple calls).
5. Call done after.

Do NOT modify the original artifact - only emit new files under ui_kits/.`;

export function pickDecomposePrompt(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? DECOMPOSE_PROMPT_ZH : DECOMPOSE_PROMPT_EN;
}
