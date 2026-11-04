# 记忆实验复核清单：R1–R4

状态：**已由用户于2026-11-01确认**。确认原话：“R1、R2同意；R3接受意图；R4按建议”。
确认数据见 [裁决记录](./memory-study-adjudication-v1.json)，离线派生结果见
[人工复核报告](./MEMORY_STUDY_REVIEWED_RESULTS.md)。原始严格成绩、别名和实时评分规则保持不变。
本清单是在查看开发集输出后整理的，人工派生结果明确标注“事后复核”。

## 复核依据

四类问题均来自 recovery-action，涉及13种不同表达（含大小写差异），不是13个独立样本。
原始调用文件的SHA-256已与已保存分析核对一致。
全量精确匹配共16个状态项：R1两项、R2三项、R3两项、R4九项。同一表达的重复
出现合并展示过；裁决记录逐项绑定全部16项，仅适用于本次冻结运行中的相同问题含义。

- 初始要求e0：“保留顶栏和 fontSize，只修复空状态。”此时下一动作参考答案为“修复空状态”。
- 失败后的要求e3：“下一动作必须先重读 App.jsx，再重试预览；不能沿用 r1 成功。”
- 后续e4继续要求保留顶栏和字号，e5没有新的读取或预览回执。
- 读取题要求只报告一项最先必须执行的动作；因此后续下一动作参考值为 `read:App.jsx`。

## 已确认的四项判断

| 编号 | 原要求／参考含义 | 模型实际回答 | 已确认结论 |
|---|---|---|---|
| R1 | 字号保持不变，规范值 `preserve` | `retain` | 接受为内容同义；原严格成绩保留，人工结论单独记录。 |
| R2 | 初始下一动作“修复空状态” | `Fix App.jsx empty state`、`fix App.jsx empty state`、`fix empty state` | 接受三种表达为内容正确；只适用于初始检查点，不能替代后续重读动作。 |
| R3 | 字号保持不变 | `保留fontSize元素` | 接受“保留字号”的意图，标注术语不严谨；其他维度错误保留。 |
| R4 | 下一动作只填“先重读 App.jsx” | “重读后重试预览”等八种表达，详见下表 | 承认保留了先读后试的理解；仍按当前单一动作要求判表达不合规，不自动删去后半句后加分。 |

R3的原始结构仍把 `fontSize` 放在field中，objectId为空，因此不能仅凭“元素”二字断言
它真的把属性当成了DOM对象。但该条同时把设计ID写成“设计A”，并引用不存在的
`evt-accept-fontSize`；即使接受其值的含义，这些作用域与来源错误也保留。

R4的JSON字段结构本身有效。这里的“不合规”指回答多填了后续动作，不应将它
改记为无效JSON。依本次裁决，只增加“顺序理解正确”的人工诊断，不将整句
直接列为规范原子值的同义别名。

## R4全部不同表达

| 实际回答 | 原始调用ID |
|---|---|
| `re-read App.jsx and retry preview for empty-state fix` | recovery-action/trial-1/1/ordinary-summary/round-1/probe |
| `重读App.jsx后重试预览` | recovery-action/trial-1/3/goal-record/round-3/probe |
| `重读App.jsx再重试预览` | recovery-action/trial-1/3/goal-record/round-2/probe |
| `re-read App.jsx then retry preview` | recovery-action/trial-1/3/stable-handoff/round-2/probe |
| `Re-read App.jsx to retry preview` | recovery-action/trial-1/3/stable-handoff/round-3/probe |
| `read App.jsx and retry preview` | recovery-action/trial-1/1/goal-recall/round-1/probe |
| `先重读 App.jsx，再重试预览` | recovery-action/trial-1/3/goal-recall/round-2/probe |
| `re-read App.jsx and retry preview` | recovery-action/trial-1/3/goal-recall/round-3/probe |

## R1–R3原始调用索引

| 编号／表达 | 原始调用ID |
|---|---|
| R1：retain | recovery-action/trial-1/3/goal-recall/round-3/probe |
| R2：Fix App.jsx empty state | recovery-action/trial-1/3/goal-record/round-1/probe |
| R2：fix App.jsx empty state | recovery-action/trial-1/3/stable-handoff/round-1/probe |
| R2：fix empty state | recovery-action/trial-1/3/goal-recall/round-1/probe |
| R3：保留fontSize元素 | recovery-action/trial-1/3/goal-record/round-3/probe |

完整证据：忽略目录 `goal-20261101/memory-short-live-001/calls.jsonl`，以及
`analyses/memory-short-001/analysis.json`。原始用户事件见 `state-stress-fixtures.ts`。

## 裁决边界

这次判断仅针对上述值／意图或表达要求，不自动修正作用域、来源、失效条件、
截断或其他格式错误。将仍获批准的颜色回答为unresolved、将历史passed改成
unresolved等不同状态，不作为同义表达提交复核。长对话没有新增同类型值的
非精确表达候选。本次接受仅用于事后人工派生；未来自动采用别名必须显式冻结新协议。
