/**
 * Decompose-trigger prompt — fired as a follow-up user message when the user
 * clicks "Decompose to UI Kit" in the chat sidebar's add menu. NOT auto-fired
 * (unlike polishPrompt.ts). Tells the agent to:
 *   1. read the current artifact,
 *   2. call decompose_to_ui_kit with the structured plan,
 *   3. call verify_ui_kit_parity to deterministically check the result,
 *   4. iterate (up to twice) if the parity score is below threshold,
 *   5. call done.
 *
 * Locale-aware in the same shape as polishPrompt.ts so tone and examples feel
 * consistent for ZH and EN users.
 */

export const DECOMPOSE_PROMPT_ZH = `把刚才那个设计拆成一个 ui_kits/<slug>/ 目录, 对齐 coding agent handoff 的形态, 做完之后用 verify_ui_kit_parity 自检一遍:

1. 先用 str_replace_based_edit_tool view index.html 把当前 artifact 完整读一遍
2. 选一个简短的 slug (kebab-case, 比如 saas-dashboard)
3. 拆解, 一次性调 decompose_to_ui_kit 把下列内容传过去:
   - indexHtml: 与原 index.html 视觉一致的整页 HTML (尽量保留所有元素 / 文本 / class 名)
   - components/*.tsx: 重复结构抽出的组件 (出现 ≥3 次的 DOM 子树), props 用 TS 类型
   - tokens.css: 原文件里出现 ≥3 次的颜色 / 间距 / 字号 / 圆角 / 阴影抽成 CSS 变量 (重要: 要把原 HTML 里 inline style 的 hex / px / rem 值都覆盖到, 漏的越少 token coverage 越高)
   - readmeNotes: 给下游 coding agent 的接入说明
4. 调 verify_ui_kit_parity({slug}) 拿一份 ParityReport. 看 parityScore:
   - 如果 status === 'ok' (parityScore >= 0.85): 直接调 done
   - 如果 status === 'needs_iteration': 看 gaps 列表, 重新调一次 decompose_to_ui_kit, 把 gaps 里报告的缺失元素 / 文本 / token 补回去, 然后再调一次 verify_ui_kit_parity
5. 最多迭代两轮 (避免无限循环). 第二轮验证完不管 score 多少都调 done, 把最终的 parityScore + 剩余 gaps 在 done 的 summary 里诚实写出来
6. 不要重写原 artifact, 只输出 ui_kits/ 下的新文件`;

export const DECOMPOSE_PROMPT_EN = `Decompose the design you just produced into a ui_kits/<slug>/ folder, shaped for coding-agent handoff, then self-verify using verify_ui_kit_parity:

1. Use str_replace_based_edit_tool view to load index.html fully first.
2. Pick a short kebab-case slug (e.g. saas-dashboard).
3. Call decompose_to_ui_kit ONCE with:
   - indexHtml: full-page HTML visually parity-matched to the source (preserve elements, text, class names where possible)
   - components/*.tsx: components extracted from repeated structure (DOM subtrees appearing >= 3 times), typed props
   - tokens.css: any color / spacing / typography / radius / shadow value used >= 3 times in the source -> a CSS variable (important: capture every hex / px / rem in the original's inline styles; the more you cover, the higher tokenCoverage scores)
   - readmeNotes: handoff notes for the downstream coding agent
4. Call verify_ui_kit_parity({slug}) and read the ParityReport:
   - If status === 'ok' (parityScore >= 0.85): call done
   - If status === 'needs_iteration': read the gaps list, re-call decompose_to_ui_kit with adjustments that address the missing elements / text / tokens, then re-call verify_ui_kit_parity
5. Iterate at most TWICE to avoid infinite loops. After the second verify, call done regardless of score and honestly state the final parityScore + any remaining gaps in done's summary.
6. Do NOT modify the original artifact - only emit new files under ui_kits/.`;

export function pickDecomposePrompt(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? DECOMPOSE_PROMPT_ZH : DECOMPOSE_PROMPT_EN;
}
