/**
 * Decompose-trigger prompt — fired as a follow-up user message when the user
 * clicks "Decompose to UI Kit" in the chat sidebar's add menu. NOT auto-fired
 * (unlike polishPrompt.ts). Walks the agent through:
 *   1. read the current artifact
 *   2. call decompose_to_ui_kit with the structured plan
 *   3. call verify_ui_kit_parity (deterministic structural check)
 *   4. call verify_ui_kit_visual_parity (vision-LLM judge with boolean rubric)
 *   5. iterate (up to twice) reconciling gaps from BOTH verifiers
 *   6. call done with HONEST cost + status + remaining gaps in the summary
 *
 * The two verifiers are complementary:
 *   - verify_ui_kit_parity is fast, free, deterministic — catches missing
 *     elements / hardcoded colors / dropped sections
 *   - verify_ui_kit_visual_parity is the LLM judge — 12 boolean checks across
 *     layout/color/typography/content/components, each yes/no with a reason.
 *     parityScore = passCount/12 (derived). Status is bounded enum.
 *
 * The visual judge follows 2026 VLM-as-judge research + NodeBench's own rule
 * patterns (pipeline_operational_standard.md, eval_flywheel.md,
 * agent_run_verdict_workflow.md): boolean per dimension, not floating-point
 * arbitrary scores. Failure-of-judge counts as failure-of-parity per
 * agentic_reliability.md HONEST_SCORES.
 *
 * The done summary MUST report:
 *   - final parityScore (deterministic + visual) as passCount/totalChecks
 *   - judgeCostUsd from the visual judge
 *   - any remaining gaps the agent could not fix in 2 iterations
 *
 * No hidden costs, no inflated scores, no quietly-failed checks.
 */

export const DECOMPOSE_PROMPT_ZH = `把刚才那个设计拆成一个 ui_kits/<slug>/ 目录, 对齐 coding agent handoff 的形态, 做完之后用两个 verifier 自检:

1. 先用 str_replace_based_edit_tool view index.html 把当前 artifact 完整读一遍
2. 选一个简短的 slug (kebab-case, 比如 saas-dashboard)
3. 一次性调 decompose_to_ui_kit:
   - indexHtml: 与原 index.html 视觉一致的整页 HTML (尽量保留所有元素 / 文本 / class 名)
   - components/*.tsx: 重复结构抽出的组件 (出现 ≥3 次的 DOM 子树), props 用 TS 类型
   - tokens.css: 原文件里出现 ≥3 次的颜色 / 间距 / 字号 / 圆角 / 阴影抽成 CSS 变量
   - readmeNotes: 给下游 coding agent 的接入说明
4. 调 verify_ui_kit_parity({slug}) 拿一份结构化 ParityReport (deterministic, 免费, 快速)
5. 调 verify_ui_kit_visual_parity({slug}) 拿视觉判定 (vision LLM judge, 12 个 boolean check)
   - 如果返回 status="unavailable", host 没接 judge callback, 跳过这一步用 step 4 的结果做决定
   - 如果返回了, 看 checks[].passed + reason, 失败的 check 就是要修的点
6. 综合两份 report (注意: 两个 verifier 的 status 词汇不同):
   - 成功条件: deterministic.status === 'ok' 且 visual.status ∈ {verified, needs_review, unavailable} → 直接调 done
   - 任一失败: deterministic.status === 'needs_iteration' 或 visual.status ∈ {needs_iteration, failed} → 把两边的 gaps 合并去重 + 失败 check 的 reason 一起作为反馈, 重新调一次 decompose_to_ui_kit
7. 最多迭代两轮. 第二轮验证完不管 score 多少都调 done.
8. done 的 summary 必须诚实写出:
   - 结构化 verifier 的 passCount/totalChecks + status
   - 视觉 judge 的 passCount/12 + status (如果可用)
   - 视觉 judge 的 judgeCostUsd (本次自检花了多少)
   - 还没解决的 gaps (列出失败的 check id + 为什么没修好)
   不要藏成本, 不要虚报 score, 失败的 check 当失败说.
9. 不要重写原 artifact, 只输出 ui_kits/ 下的新文件`;

export const DECOMPOSE_PROMPT_EN = `Decompose the design you just produced into a ui_kits/<slug>/ folder, shaped for coding-agent handoff, then self-verify using TWO complementary verifiers:

1. Use str_replace_based_edit_tool view to load index.html fully first.
2. Pick a short kebab-case slug (e.g. saas-dashboard).
3. Call decompose_to_ui_kit ONCE with:
   - indexHtml: full-page HTML visually parity-matched to the source (preserve elements, text, class names where possible)
   - components/*.tsx: components extracted from repeated structure (DOM subtrees appearing >= 3 times), typed props
   - tokens.css: any color / spacing / typography / radius / shadow value used >= 3 times in the source -> a CSS variable
   - readmeNotes: handoff notes for the downstream coding agent
4. Call verify_ui_kit_parity({slug}) — deterministic structural check (fast, free), returns ParityReport with element-count / text-coverage / token-coverage signals.
5. Call verify_ui_kit_visual_parity({slug}) — vision-LLM judge with the 12 standard boolean checks (layout / color / typography / content / components dimensions). Each check is yes/no with a reason. parityScore = passCount/12 (derived deterministically).
   - If it returns status="unavailable", the host hasn't injected the judge callback. Proceed with step 4's deterministic report alone.
   - If it returns successfully, read each checks[].passed + reason. Failed checks are the things to fix.
6. Reconcile both reports (NOTE: the two verifiers use DIFFERENT status vocabularies):
   - Success: deterministic.status === 'ok' AND visual.status ∈ {verified, needs_review, unavailable} → call done
   - Iterate: deterministic.status === 'needs_iteration' OR visual.status ∈ {needs_iteration, failed} → merge + dedup gaps from both reports + the failed checks' reasons, re-call decompose_to_ui_kit addressing them
7. Iterate at most TWICE. After the second verify, call done regardless of score.
8. The done summary MUST honestly report:
   - deterministic verifier passCount/totalChecks + status
   - visual judge passCount/12 + status (if available)
   - visual judge judgeCostUsd (what this self-verify cost)
   - remaining gaps the loop could not resolve (list failed check ids + why they didn't get fixed)
   Do NOT hide cost. Do NOT inflate scores. Failed checks count as failed.
9. Do NOT modify the original artifact - only emit new files under ui_kits/.`;

export function pickDecomposePrompt(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? DECOMPOSE_PROMPT_ZH : DECOMPOSE_PROMPT_EN;
}
