# 状态评测：读取校准与压力实验

日期：2026-11-01。执行入口已准备；本次交付只运行离线测试和预演，不代表真实模型已经通过校准。

续：第001轮完整前缀校准已经运行，结果见 [分析](./READER_CALIBRATION_001_RESULTS.md)。现已修订 [读取合同v2](./READER_CONTRACT_V2.md)。由于Computer Use不暴露终端窗口，用户选择 [一次手动启动受限执行器](./BOUNDED_EXPERIMENT_HOST.md)，之后由研究任务提交冻结批次。下面state-live-20261101的手动运行命令属于先前版本；源码变更后应使用新预演，不能直接复用旧计划。

## 顺序与预算

先运行未压缩读取校准，再查看结果决定压力实验。两个批次独立执行，不自动串联，不自动重试或续跑。

| 批次 | 输入 | 计划调用 | 状态分母 |
|---|---|---|---|
| calibration | 4条轨迹各自截至e1/e3/e5的原始前缀 | 0次压缩＋12次读取 | 全部27项，最终检查点9项 |
| stress | 普通摘要／目标记录摘要，各1次／3次压缩 | 32次压缩＋32次读取＝64次 | 全阶段72项，最终36项；每组最终9项 |

12次校准与64次压力实验共最多76次计划调用，分开记录。校准使用同一套读取提示词、JSON结构和四维评分；原始前缀作为frozenMemory提供，读取器不接触参考答案、别名或裁决表。校准各检查点独立，不反馈先前回答，也不调用压缩器。

读取校准的`readiness.passed=true`要求12个请求均运行有效、格式合规，27项状态四维全部正确。若失败，先区分运行／格式错误、来源或状态理解错误、新的等义表达，再复核；不能将读取器在完整前缀上的失误解释成压缩遗忘，也不自动修复答案或扩充评分表。规则或提示词修改后，应另存版本并重新预演、校准。

这些材料是单人复核的短合成案例，适合定位链路和失败类型；即使全部通过，也不能宣称真实长对话表现、完整任务完成或统计显著性。

## 配置与预演

在仓库根目录使用Node22及pnpm。模板为`state-reader-calibration.example.json`和`state-stress.example.json`；复制到`.Codex/workspace/goal-aware-context/`后按已有配置填写模型信息，勿将密钥写入JSON或命令行。两种角色仍使用统一配置；校准只读取reader的凭据环境变量。

沿用已确认模型、接口和窗口声明。当前本地Doubao配置为Doubao-Seed-2.0-mini，实际请求名ark-code-latest，火山方舟手动固定，后端版本未知。保持2048输入预算、4096输出额度、1800字节摘要上限、1轮、60秒超时、无重试。预算估算必须明确允许，不能称精确等token。

以下使用个人配置路径举例；每个输出目录必须是新目录：

```powershell
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json research/goal-aware-context/state-stress-cli.ts --track calibration --config .Codex/workspace/goal-aware-context/state-live-20261101/reader-calibration.local.json --output .Codex/workspace/goal-aware-context/state-live-20261101/calibration-dry-001

pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json research/goal-aware-context/state-stress-cli.ts --track stress --config .Codex/workspace/goal-aware-context/state-live-20261101/stress.local.json --output .Codex/workspace/goal-aware-context/state-live-20261101/stress-dry-001
```

没有`--execute`时不读取密钥或加载供应商，实际调用0次，groups/readiness为null，不产生模型成绩。确认计划分别为12次、64次。

本次工作树交付已生成上述两个预演目录，可直接使用下方真实运行命令。需要重建时请使用新的目录编号，并同步修改真实运行的--preflight路径。

## 人工启动真实运行

先确认当前PowerShell中的`CODESIGN_READER_KEY`已设置，不打印密钥。使用上一步生成的对应plan.json：

```powershell
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json research/goal-aware-context/state-stress-cli.ts --track calibration --config .Codex/workspace/goal-aware-context/state-live-20261101/reader-calibration.local.json --preflight .Codex/workspace/goal-aware-context/state-live-20261101/calibration-dry-001/plan.json --output .Codex/workspace/goal-aware-context/state-live-20261101/reader-calibration-live-001 --execute
```

执行必须显式指定`--track`、`--config`、`--preflight`和正数调用上限。读取预演计划后，核对完整当前计划；源码、模型配置、题面或规则改变时拒绝旧计划，且不会创建新输出目录或访问供应商。源码指纹覆盖研究实现、供应商目录下递归TS源码和锁文件。

校准结果整理完，再手动执行压力批次；另需`CODESIGN_COMPRESSOR_KEY`：

```powershell
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json research/goal-aware-context/state-stress-cli.ts --track stress --config .Codex/workspace/goal-aware-context/state-live-20261101/stress.local.json --preflight .Codex/workspace/goal-aware-context/state-live-20261101/stress-dry-001/plan.json --output .Codex/workspace/goal-aware-context/state-live-20261101/stress-live-001 --execute
```

研究程序内的正调用上限是硬上限；较低上限会保留未完成题目的分母，不缩小计划。不要为补齐结果而直接重复执行旧批次；新的运行应使用新目录并单独记录。

## 日志、中断与退出码

- plan.json／manifest.json：公开输入、模型身份、预演和规则指纹。
- calls.jsonl：每次调用前保存about-to-call，再保存安全的response；不持久化原始供应商异常字符串，凭据回显被脱敏。
- observations.jsonl：逐题校准观察；压力轨迹在链结束时保存经超限处理的观察。
- report.json：开始时为running，结束时为complete或incomplete。调用或日志异常会保留已有日志；无法确定实际调用数时填null，不能当作0次。

Ctrl+C或SIGTERM请求取消当前调用并保存后续不可用项。强制杀进程可能留下running报告或不完整JSONL尾行，此时应按未完成批次检查已有请求／响应，不能据此声称调用数精确或任务完成。

退出码0表示程序已完成且运行／格式有效，内容答错仍会出现在四维评分和readiness中；2表示中断、跳过或运行／格式失败；1表示参数、准备、预演不匹配或持久化等致命错误。退出码0不等于模型全部答对。

历史第003轮及人工裁决保持独立；本次校准与压力批次不改写原始101/135或事后复核116/135。
