/**
 * Decompose-trigger prompt — fired as a follow-up user message when the user
 * clicks "Decompose to UI Kit" in the chat sidebar's add menu. NOT auto-fired
 * (unlike polishPrompt.ts). Walks the agent through:
 *   1. read the current artifact
 *   2. call decompose_to_ui_kit with the structured plan
 *   3. call verify_ui_kit_parity (deterministic structural check)
 *   4. call verify_ui_kit_visual_parity (vision-LLM judge, if available)
 *   5. iterate (up to twice) if either parity score is below threshold
 *   6. call done
 *
 * The two verifiers are complementary:
 *   - verify_ui_kit_parity is fast, free, deterministic — catches missing
 *     elements / hardcoded colors / dropped sections
 *   - verify_ui_kit_visual_parity is the LLM judge — catches things the
 *     structural check can't see (visual layout drift, color shade, font
 *     weight, component density)
 *
 * The visual judge follows 2026 VLM-as-judge research (WebDevJudge / Prometheus-
 * Vision / Trust-but-Verify ICCV 2025): structured rubric tree with per-aspect
 * scoring + reasoning-then-score chain-of-thought. When the host hasn't injected
 * the judge callback, the visual tool returns status="unavailable" and the
 * agent proceeds with deterministic-only.
 */

export const DECOMPOSE_PROMPT_ZH = `把刚才那个设计拆成一个 ui_kits/<slug>/ 目录, 对齐 coding agent handoff 的形态, 做完之后用两个 verifier 自检:

1. 先用 str_replace_based_edit_tool view index.html 把当前 artifact 完整读一遍
2. 选一个简短的 slug (kebab-case, 比如 saas-dashboard)
3. 一次性调 decompose_to_ui_kit 把下列内容传过去:
   - indexHtml: 与原 index.html 视觉一致的整页 HTML (尽量保留所有元素 / 文本 / class 名)
   - components/*.tsx: 重复结构抽出的组件 (出现 ≥3 次的 DOM 子树), props 用 TS 类型
   - tokens.css: 原文件里出现 ≥3 次的颜色 / 间距 / 字号 / 圆角 / 阴影抽成 CSS 变量
   - readmeNotes: 给下游 coding agent 的接入说明
4. 调 verify_ui_kit_parity({slug}) 拿一份结构化 ParityReport (deterministic)
5. 调 verify_ui_kit_visual_parity({slug}) 拿视觉判定 (vision LLM judge)
   - 如果返回 status="unavailable", 说明 host 没接 judge callback, 跳过这一步用 step 4 的结果做决定
6. 综合两份 report:
   - 两个都 status === 'ok' (parityScore >= 0.85): 直接调 done
   - 任一为 needs_iteration: 把两边的 gaps 合并去重, 重新调一次 decompose_to_ui_kit 把缺失的元素 / 文本 / token / 视觉细节补回去
7. 最多迭代两轮. 第二轮验证完不管 score 多少都调 done, 在 done 的 summary 里诚实写出最终 parityScore + 剩余 gaps
8. 不要重写原 artifact, 只输出 ui_kits/ 下的新文件`;

export const DECOMPOSE_PROMPT_EN = `Decompose the design you just produced into a ui_kits/<slug>/ folder, shaped for coding-agent handoff, then self-verify using TWO complementary verifiers:

1. Use str_replace_based_edit_tool view to load index.html fully first.
2. Pick a short kebab-case slug (e.g. saas-dashboard).
3. Call decompose_to_ui_kit ONCE with:
   - indexHtml: full-page HTML visually parity-matched to the source (preserve elements, text, class names where possible)
   - components/*.tsx: components extracted from repeated structure (DOM subtrees appearing >= 3 times), typed props
   - tokens.css: any color / spacing / typography / radius / shadow value used >= 3 times in the source -> a CSS variable
   - readmeNotes: handoff notes for the downstream coding agent
4. Call verify_ui_kit_parity({slug}) — deterministic structural check, returns ParityReport with element-count / text-coverage / token-coverage signals.
5. Call verify_ui_kit_visual_parity({slug}) — vision-LLM judge with structured rubric (layout / color / typography / content / components per-aspect scores).
   - If it returns status="unavailable", the host hasn't injected the judge callback. Proceed with step 4's deterministic report alone.
6. Reconcile both reports:
   - Both status === 'ok' (parityScore >= 0.85): call done
   - Either status === 'needs_iteration': merge + dedup gaps from both, re-call decompose_to_ui_kit with adjustments addressing the missing elements / text / tokens / visual details
7. Iterate at most TWICE. After the second verify, call done regardless of score; honestly state the final parityScore from BOTH verifiers + any remaining gaps in done's summary.
8. Do NOT modify the original artifact - only emit new files under ui_kits/.`;

export function pickDecomposePrompt(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? DECOMPOSE_PROMPT_ZH : DECOMPOSE_PROMPT_EN;
}
