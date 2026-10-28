# 统一上下文评测入口

本入口整合现有生产基线、冻结语料与 Sun 的摘要/宿主状态实验。默认只生成计划，不读取密钥、不加载真实模型调用依赖、不发请求。它独立使用当前分支的 pi provider 接口，不再依赖另外两个工作树的路径。已有 LIVE/HOST 结果文件保持历史记录，不据本次代码改动重算。

## 一条命令先看计划

仓库根目录、Node22 和现有冻结 pnpm 依赖：

~~~bash
pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json \
  research/goal-aware-context/unified-cli.ts \
  --config research/goal-aware-context/unified-pilot.example.json \
  --output .Codex/workspace/goal-aware-context/unified-pilot-001
~~~

输出目录必须不存在；不会覆盖已有证据。示例是两个开发集截止点、一个宿主截止点、2K输入档位、一次试验，最多计划47次模型调用，配置上限60次。具体实际调用数可能因超限、无效摘要或服务失败而减少；失败仍留在原分母中。

示例中的模型和域名是占位符，执行模式会拒绝它们。直接省略 config 可生成全开发集计划：默认8个开发集截止点、6个宿主截止点、2K/4K/8K、三次试验，调用上界1359次；默认 maxCalls=0，不可直接执行。先用小批量校准，完整批次前重看计划。

## 两组实验，各自比较

**压缩策略组**使用同一份生产格式前缀及当时的状态：

- 完整历史是参考，只要求不超过所声明模型窗口，不能与压缩档位混作同一预算结果。
- production-raw 原样调用生产 pack，保留它的原始字符预算；超限就记失败。
- production-matched 在预先声明的历史字符预算网格24000/16000/12000/8000/4000/2000/1000/0中，选择第一个能让所有读题请求通过预算的设置。保留 brief/workspace 开销；不事后裁剪结果。
- ordinary-summary / goal-record 复用原 live 实验的两种提示策略，只给压缩器同一前缀和通用恢复目标。摘要字节上限对两者相同并在计划中冻结。然后逐题评测，同一条件所有题共用一个冻结上下文。

**宿主事实组**复用原 host 场景与状态 API。每个截止点/档位/试验只生成一次 model-record 摘要，两分支共享完全相同的摘要。随后比较 model-only 和 host-facts：两者使用相同读题协议和目录，后者额外收到宿主当前事实。两个分支使用相互独立、同源的回放实例与 gate，避免前一分支改变后一分支状态。偶数试验反转读题顺序。

宿主组是额外事实的架构干预，不是同信息摘要提示比较；两组使用不同数据，不合并分数或与旧试验直接排名。预览结果/对象选择来自受控夹具，未运行实际桌面预览或模型写文件。gate拒绝不计作模型答对。

## 完整预算与计数边界

每次请求都在发送前检查系统提示、上下文、历史、问题与schema说明。压缩器按自身声明窗口检查；压缩条件的读题按2K/4K/8K总输入上限检查，同时预留 maxOutputTokens。完整历史单独按模型窗口检查。一个条件的全部问题先统一预检；任何一题超限都不发该条件的读题请求，不逐题缩短上下文。宿主两个分支也先同时预检，一侧超限则两侧均跳过。

默认没有模型兼容的精确计数器。程序 API 可以注入按模型版本固定的计数器；其输入是完整请求 envelope，必须计入 envelopeMessages 所产生的实际消息包装及供应商 framing。若无法计数，失败保留 null。只有显式 allowEstimatedBudget=true 才允许估算校准；这种结果始终标注 estimate，不称为精确等 token 对比。CLI目前只内置既有UTF-8/4估算，正式精确预算实验需通过 API 注入可靠计数器。

供应商返回的 input/output/cost 单独记录，不能覆盖预检估算。当前 pi wrapper 可能缺少缓存输入计数，也会将缺失值表示为0，因此完整输入用量和实际账单保持 unknown/null，报告只汇总已报告的小计。若已报告输入本身已超限、输出超过约定上限或已报告总量超过窗口，标记 provider-overflow，整个压缩条件的主评分归零并停止剩余读题；宿主组任一分支超限，两分支主评分同时归零，另一侧标记 paired-provider-overflow。原始调用与已执行 gate 仍保留作诊断，不进入有效预算比较。不自动调小后重试。启用 reasoning 时，部分 pi 适配器（如旧式 Anthropic thinking）还会增加发送的输出额度；maxOutputTokens 是本实验请求/评分约定，不能当作账单硬上限。初次校准应固定并核对 reasoning 设置，额外额度/缓存/远端用量仍按上述边界解释。

## 真实调用需要显式启用

1. 复制示例到个人配置文件，填写实际 compressor/reader 的 provider、精确模型ID、已验证的服务地址/wire以及可用窗口上限。也可让两角色用同一模型，分别运行两个模型配置作比较。不要把密钥写入配置或 Git。
2. 只在本地设置 credentialEnv 所指环境变量。keyless 服务需显式 allowKeyless=true。默认不读取已有应用账户或全局配置，也不猜测可用凭据。
3. 检查 dry-run 的 plannedCalls、maxCalls、试验次数和全部提示。真实服务的模型ID/窗口和输出限制需要操作者确认；请求传入上限不等于服务必定遵守，返回的截断会作为失败保留。
4. 使用同一命令并显式增加 --execute。没有配置、没有正调用上限或仍含占位模型时，启动即失败。执行不会因为配置中写了某字段而被自动开启。
5. CLI以 prompt-only JSON 对所有服务使用同一协议，不额外使用另一分支支持的 json_schema，避免当前 provider 接口不兼容。无JSON修复、模型替换、输出裁剪或自动重试。

实验强制传入 maxRetries=0。当前只接受实际解析为 openai-completions、openai-responses 或 anthropic-messages 的 pi 适配器；其他适配器（包括内部自行重试的 Codex）在发送前拒绝。此处按锁定的 pi 版本核对其 SDK 选项，不保证网关服务内部不会重试。应用其他调用者未传该选项时维持原默认行为。actualProviderCalls 统计 complete 边界调用次数，被适配器拒绝的调用也计入保守上限，不等同成功 HTTP 请求数。

达到上限、取消、超时或服务错误后不会偷偷续跑；SIGINT/SIGTERM将中断当前请求并保留已有日志。远端停止属于 best-effort abort，不据本地取消断言免于计费。provider错误内容与凭据不会原样落盘；发现凭据回显立即停止。执行有协议/服务失败时CLI返回2，启动/存储失败返回1；有效但答错的模型结果保留正常试验分数。

## 证据文件

- manifest.json：来源/实现/锁文件与计划指纹、模型配置和运行模式。
- plan.json：截止点输入、条件、提示、公开问题和精确调用上界；不含评分答案或标签。
- calls.jsonl：即将调用和响应两个事件，逐次写入；含请求摘要/原文、usage与耗时。
- contexts.jsonl：发读题请求前写入的冻结上下文、来源与内容指纹。
- observations.jsonl：每个条件的终态、预算、分数、失败及gate结果；提前失败也有记录。
- report.json：分组/方法/预算的计数汇总、已报告usage小计与限制。dry-run不填写未运行的正确率。
- workspaces/：仅用于受控宿主回放的合成文件。整个输出留在忽略目录，不加入Git。

程序 API：prepareUnifiedPlan(loadUnifiedData(), parseUnifiedConfig(config), workspace) 后调用 runUnified(prepared, options, dependencies)。执行前会对照当前实现和锁文件指纹；保存的计划在代码或依赖变化后必须重新生成。默认 options.execute=false；执行时显式传入本分支 pi complete、getCredential、可选 counters 和有限额配置。自定义CLI/调用者应同时落盘session的onRequest和run options中的onCall/onContext/onObservation事件；观察者存储失败会中止，不继续消费模型。

## 数据与解释范围

仍是合成开发语料。原冻结 manifest、参考问题和保留集保持不变，保留集不用于当前调参。R1–R5人工复核记录可追溯，其余记录不能据此称独立人工金标。多次试验和同设计的多个截止点是相关观察，不视为独立样本；报告计数不包含显著性结论。NL状态提取/约束遵守质量需实际模型数据，真实文件修改与视觉验收仍属后续工作。

已知报告小项：程序 API 若显式传入 estimate 计数器而未允许估算，逐请求预算仍正确显示 unavailable 并阻止调用，但报告顶层 counterIds 可能保留传入计数器名称。判定以 observations 中逐请求 measurements 为准；CLI 默认路径不受此情况影响。

## 本次实施取舍

- 复用已整合的 Sun 实验与调用记录方式，上限改为配置项；代价是正式执行前需要逐项核对配置。
- 当前分支统一采用提示词约定 JSON；代价是格式失败也会保留，不等价于供应商强制结构化输出。
- 保留合成材料与已有人工复核的实际范围；代价是结论不能推广为独立金标上的效果。
- 验证材料保留在本地忽略目录；代价是占用本地空间，不随 Git 自动共享。
- 仅让可明确禁重试的适配器进入本实验；代价是支持范围较窄，应用原调用默认值不变。
- 实际超限使整个条件/配对主评分归零；代价是保守舍弃部分正确答案，原始记录仍可诊断。

## 本轮验证（2026-10-27）

研究测试190项、provider包231项通过；仓库 pnpm test、pnpm typecheck、pnpm lint 均通过。最终仓库测试含10个已通过缓存任务和重新运行的桌面任务（3027通过、12按原配置跳过）。两份研究类型配置也通过。离线小批量计划47次、全开发计划1359次，均为0次实际调用，未运行分数保持null。

本工作树先前依赖不完整，曾出现测试入口缺失、Electron依赖元数据缺失及一次遗漏研究tsconfig的命令错误；已修复并重跑。完整日志、失败记录及 verification.json 保存在本地忽略目录 .Codex/workspace/goal-aware-context/unified-runner/。正式模型质量、实际账单与完整等token比较均未验证。

复核命令：node packages/core/node_modules/vitest/vitest.mjs run --config research/goal-aware-context/vitest.config.mjs；pnpm --filter @open-codesign/providers test；pnpm test；pnpm typecheck；pnpm lint。研究类型检查分别使用 pnpm exec tsc -p research/goal-aware-context/tsconfig.json 和 pnpm exec tsc -p research/goal-aware-context/host.tsconfig.json。

## 评分协议 v2（2026-10-28）

新运行采用 [评分协议v2](./SCORING_PROTOCOL_V2.md) 和独立人工裁决覆盖层；旧语料与运行结果保留。压缩组逐题报告内容、格式和综合成功，未知格式异常进入复核队列。新增 [完整开发集模板](./unified-development.example.json)：8个开发检查点、6个宿主案例，2K一轮最多169次调用；输出额度4096、摘要上限1800字节。模型身份可通过目标配置中的modelIdentity记录用户确认，和实际请求modelId分别保留。

离线复算：pnpm exec tsx --tsconfig research/goal-aware-context/tsconfig.json research/goal-aware-context/unified-rescore.ts .Codex/workspace/goal-aware-context <全新派生输出目录>。要求原始两轮日志与冻结哈希一致；不读取API密钥。

## 开发集实跑结果（2026-10-28）

[第003轮结果与校准汇总](./DEVELOPMENT_003_RESULTS.md)记录169次计划、156次实际调用及各类失败。当前严格压缩组101/135；[18项待复核清单](./DEVELOPMENT_003_REVIEW.md)中的14项同义/翻译、1项范围争议及3项格式内容判断尚未获得本轮人工确认，不改写原分数。宿主事实组独立统计。
