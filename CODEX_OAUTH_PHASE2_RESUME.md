# Codex ChatGPT 订阅登录 — Phase 2 Resume

> 上次工作到哪：Phase 1 MVP 写完，真机测试遇到协议不兼容；main 上 UI 已降级为"正在支持中"状态，feat 分支保留全部开发历史 + 未完成代码。下一阶段做 **pi-agent-core 统一链路**。

---

## 当前状态

### Main 分支
- **UI 已安全降级**：Settings 顶部 `ChatgptLoginCard` 显示 "用 ChatGPT 订阅登录 / Sign in with ChatGPT subscription" 标题 + "功能仍在打磨中" 说明 + 禁用的 "正在支持中" / "Coming soon" 按钮。点不动。
- **Codex 导入错误友好化**：`config:v1:import-codex-config` 检测 `auth_mode: chatgpt` 时抛双语提示（Codex 订阅用户不会再看到 `Codex config has no providers to bring in`）。
- **所有 codex 代码仍在 main**：`packages/providers/src/codex/*`、`apps/desktop/src/main/codex-oauth-ipc.ts`、`codex-generate.ts`、`codex-title.ts` 等都还在（避免大规模 revert 风险）。IPC handlers `codex-oauth:v1:*` 仍注册，但没人调用（UI 卡片不调）。
- **残留风险**：用户如果之前测试过、`config.toml` 里已有 `chatgpt-codex` provider，ModelSwitcher 会看到它；选中 + 生成会走 `runCodexGenerate` → CodexClient，目前 `stream:true` + `instructions` 顶层已修，实际能否跑通**取决于**后端对我们的 model 名 / originator / 账号订阅类型的响应。v0.x 用户小，可忽略。

### feat/codex-chatgpt-oauth 分支
保留 **全部历史** + 我后来给 card 加 `useT()` i18n key 之前的 performLogin/performLogout 全实现（以便下次一键翻转）。

---

## Phase 1 实现骨架（已经跑通的部分）

### `packages/providers/src/codex/`
- `oauth.ts`：PKCE 生成、authorize URL 构造、`exchangeCode` / `refreshTokens`（`application/x-www-form-urlencoded`，**不带 state**）、`decodeJwtClaims` / `extractAccountId`（三路 fallback）
- `oauth-server.ts`：localhost:1455 callback server，CSRF state 校验，5 分钟超时，EADDRINUSE 快速失败（**不** fallback 随机端口，因为 Codex CLI 的 client_id 只认 1455）
- `token-store.ts`：JSON 文件 0o600，5 分钟主动刷新 buffer，并发 refresh 单例 Promise 去重，`invalid_grant` 时清除本地 token
- `client.ts`：`POST chatgpt.com/backend-api/codex/responses`，已切 `stream: true` + SSE 解析 + 401 retry via `forceRefresh`。**但这条路的存在本身是债**，Phase 2 要删。

### `apps/desktop/src/main/`
- `codex-oauth-ipc.ts`：`codex-oauth:v1:status/login/logout` handler，登录后自动注入 `chatgpt-codex` ProviderEntry，自动设为 active（如果之前无 active）
- `codex-generate.ts`：`runCodexGenerate` 从 ChatMessage[] 构造 Responses API `{instructions, input}`，调 CodexClient.chat，artifact 解析
- `codex-title.ts`：title 生成专用（Phase 1 特别写的 shim，因为 pi-ai 的 generateTitle 不支持 OAuth）
- `index.ts`：`codesign:v1:generate` 里有 `isChatgptCodex` 分支；`codesign:v1:generate-title` 里同样分支；legacy `codesign:generate` 拒绝 chatgpt-codex

### UI
- `ChatgptLoginCard.tsx`：三状态（未登录 / loading / 已登录）。**现 main 上降级为单一"正在支持中"**，完整实现保留在 feat 分支。

---

## Phase 2：统一到 pi-agent-core

### 为什么当前不统一
pi-ai 的 `openai-responses` adapter（`node_modules/.pnpm/@mariozechner+pi-ai@0.67.68/.../providers/openai-responses-shared.js:65-69`）**硬编码把 systemPrompt 作为 `{role: 'system'|'developer'}` 消息塞进 `input[]`**，而 ChatGPT Codex 后端**要求 `instructions` 字段在顶层**（否则 400 "Instructions are required"）。

所以 pi-ai 的 openai-responses wire 无法直接打 `chatgpt.com/backend-api/codex`。硬塞 baseURL 会在第一次请求 400。

### 三条可行路径

#### A. 改 pi-ai 上游 / fork adapter（推荐长期方案）
Vercel AI SDK 的 `@ai-sdk/openai` 早已支持 `providerOptions.openai.instructions` 作为顶层字段 + `systemMessageMode: "remove"` 从 input 里剔除 system message（`packages/openai/src/responses/openai-responses-language-model.ts:L355`）。

pi-ai 若没这个 option：
- 最好给 `@mariozechner/pi-ai` 提 PR，加个 `useTopLevelInstructions: true` flag
- 或者在 `packages/providers` 里 fork `openai-responses-shared.js` 那一小段转换逻辑（~80 LOC），对 `chatgpt-codex` 这个 provider id 自动启用 top-level instructions 模式

然后给 pi-ai 注册一个 synthetic `chatgpt-codex` model（我们已有 wire/baseUrl 基础设施，参考 `packages/providers/src/index.ts:synthesizeWireModel`），auth 走 custom `fetch`（pi-ai 支持通过 httpHeaders 注入）。

#### B. opencode 模式：custom fetch 拦截（研究结论，最轻）
opencode 不自己写 agent loop，用 Vercel AI SDK。对 Codex OAuth 的处理只干两件事：
1. plugin 里替换 adapter 的 `fetch`：
   - 删 dummy `authorization` header，换成 `Bearer ${oauth.access}`
   - 有 accountId 就加 `ChatGPT-Account-Id`
   - URL 改写：`if pathname.includes('/v1/responses')` → `chatgpt.com/backend-api/codex/responses`
   - token 过期自动 refresh，写回 auth store
2. `chat.headers` hook 加 `originator`、`User-Agent`、`session_id`；`chat.params` hook 把 `maxOutputTokens` 置 undefined

opencode 源码：`sst/opencode/packages/opencode/src/plugin/codex.ts`（实际是 raw.githubusercontent.com/anomalyco/opencode/dev/… GitHub 自动重定向）。

移植到 pi-ai 生态：不太可能干净复用（pi-ai 没有同样的 plugin hooks），但思路是一致的 —— 在 HTTP 层做最小介入，不动上游协议。

#### C. 自己写 StreamFn adapter（中等工作量）
pi-agent-core 的 `runAgentLoop` 接受 `streamFn?: StreamFn` 参数（`node_modules/.pnpm/.../pi-agent-core/dist/agent-loop.d.ts:14`），签名与 pi-ai 的 `streamSimple` 一致，返回 `AssistantMessageEventStream`。

我们写一个自己的 streamFn：
- `model.provider === 'chatgpt-codex'` → 调 CodexClient（现有实现可复用），把 SSE 翻译成 pi-ai 的 `AssistantMessageEvent` 序列（`response.output_text.delta` → text delta event、`response.completed` → message end event）
- 其他 → 调 pi-ai 的 `streamSimple`

然后 `generateViaAgent` 和一个新的 `generateNonAgent`（或复用 generateViaAgent with tools=[]）都走这个 streamFn。

工作量：
- Event 翻译层 ~150 LOC
- 注册 synthetic model + wire 到 pi-ai ~50 LOC
- 替换 core 的 streamFn 注入点 ~50 LOC
- 删 `runCodexGenerate` + `codex-title` + `isChatgptCodex` 分支 ~ -300 LOC
- 测试调整 ~100 LOC
- **合计 1-1.5 天**

### 推荐路径：先 B 后 A
1. **第一轮**：按 B（opencode 模式）做一个 minimal custom-fetch 包装到 pi-ai 的 openai-responses adapter 上。如果 pi-ai 的当前 options 允许注入 fetch，直接干；不行就 fork adapter。验证能不能打通（instructions + stream + auth + token refresh）。
2. **第二轮**：把这个 adapter 收到 `packages/providers/src/codex/`，替换现有 CodexClient。`runCodexGenerate` / `codex-title` 删除。上游 generate / generateTitle / generateViaAgent 零改动。
3. **第三轮（optional）**：给 pi-ai 提 PR 加官方 `topLevelInstructions` option，我们 fork 删掉。

---

## Phase 2 任务清单（从这里接着做）

1. **Checkout 到 feat 分支**：`git checkout feat/codex-chatgpt-oauth`，从 main 合并最新
2. **翻转 `ChatgptLoginCard`**：把 `_props` 版本换回 `ChatgptLoginCardFull` 全实现（git history 里有）
3. **读 pi-ai 源码**：`node_modules/.pnpm/@mariozechner+pi-ai@0.67.68/.../providers/openai-responses.js` + `openai-responses-shared.js`，确认有没有任何现成的 `instructions` 注入点
4. **决定 A/B/C 路线**：读完源码后根据实际 flexibility 选
5. **实现 adapter**：写 custom fetch 拦截 + instructions 注入 + token refresh
6. **接入 core**：让 `complete()` / `generate()` / `generateViaAgent()` 看到 `chatgpt-codex` 时用新 adapter
7. **删冗余**：runCodexGenerate、codex-title、isChatgptCodex 分支
8. **真机测试**：订阅用户登录 → 生成 → 标题 → 登出 → 过期 refresh
9. **model 名单验证**：用真 token 打一次 `chatgpt.com/backend-api/codex/models`（如果存在），看返回哪些 model ID，校准 modelsHint
10. **把 main 上的 "正在支持中" 撤掉**：改回完整 ChatgptLoginCard，push

---

## 已知陷阱（踩过的雷）

| # | 坑 | 状态 |
|---|---|---|
| 1 | Token exchange body 不能有 `state`（OpenAI 后端 400） | ✅ 已修 |
| 2 | `account_id` 要从 id_token JWT claims 三路回退解析 | ✅ 已修 |
| 3 | Port 1455 占用 fallback 随机端口会 redirect_uri_mismatch（Codex CLI client_id 只认 1455） | ✅ 已修，改成直接抛错 |
| 4 | Token 文件父目录权限要 0o700（对齐 Codex CLI / gh CLI 惯例） | ✅ 已修 |
| 5 | `invalid_grant` 时必须清本地 token，否则 UI 永远 "已登录" 但实际无效 | ✅ 已修 |
| 6 | `stream: false` 被后端拒（400 "Stream must be set to true"） | ✅ 已修 |
| 7 | System prompt 不能在 `input[]` 作为 role，必须在顶层 `instructions` | ✅ 已修 |
| 8 | Content 要用 `[{type: 'input_text'/'output_text', text}]` 数组，不能用 string shorthand | ✅ 已修 |
| 9 | HTML escape OAuth 错误页（localhost XSS 面） | ✅ 已修 |
| 10 | 主 checkout 和 worktree 共用 `.git`，切分支容易污染 main checkout 工作区 | ⚠️ 注意 |
| 11 | **Model 名是否 ChatGPT 后端接受未经真机验证** | ❌ 待验证 |
| 12 | `originator` header 我们用 `open-codesign`；后端是否限定白名单（`codex_cli_rs` / 类似）未知 | ❌ 待验证 |
| 13 | Agent loop + tool calls：CodexClient 当前 Phase 1 不支持 tool_use，统一到 pi-agent-core 时 tool 路径未验证 | ❌ 待验证 |

---

## 参考源码

| 项目 | 路径 | 用途 |
|---|---|---|
| Codex CLI 官方 | `openai/codex:codex-rs/chatgpt/src/chatgpt_client.rs` | 标准请求构造、headers |
| Codex CLI 官方 | `openai/codex:codex-rs/login/src/auth/manager.rs` | OAuth 刷新流程、client_id 常量 |
| opencode | `sst/opencode:packages/opencode/src/plugin/codex.ts` | 最干净的 custom-fetch 拦截模式 |
| Cline | `cline/cline:src/integrations/openai-codex/oauth.ts` | OAuth 完整封装 |
| Cline | `cline/cline:src/core/api/providers/openai-codex.ts` | SSE/WS 双模式 + request body |
| Cline | `cline/cline:src/shared/api.ts:2008-2081` | 6 个 Codex model 定义（`gpt-5.3-codex` 为 flagship default） |
| pi-ai | `@mariozechner/pi-ai@0.67.68/dist/providers/openai-responses-shared.js:65-69` | systemPrompt 插 input 的代码（要改的点） |
| pi-agent-core | `@mariozechner/pi-agent-core@0.67.68/dist/agent-loop.d.ts` | `runAgentLoop` 的 streamFn 接口 |

---

## Phase 1 → Phase 2 的 "绿道"

如果哪天需要**紧急恢复 Phase 1 临时跑通**（比如做 demo）：
1. `git checkout feat/codex-chatgpt-oauth`
2. 把 `apps/desktop/src/renderer/src/components/ChatgptLoginCard.tsx` 的降级版替换回 `ChatgptLoginCardFull` 实现（从 `git log --oneline -- apps/desktop/src/renderer/src/components/ChatgptLoginCard.tsx` 找 commit，`git show <sha> -- ChatgptLoginCard.tsx`）
3. 真机测试一下当前协议兼容度（`stream:true` + `instructions` 都对了，可能能跑）
4. 如果 model 名不对，按 error response 校准 `CHATGPT_CODEX_PROVIDER.defaultModel` + `modelsHint`
5. 真的要从 feat 合并回 main 前，**重新跑一遍 "登录→生成→标题→过期刷新→登出" 全路径**

---

## 联系方式 / 相关讨论

- 研究记录都在这个文档里，不用再单独查
- Phase 1 实现 commit 历史：`git log --oneline 7a0fdea..feat/codex-chatgpt-oauth` 前 31 个 commit
- 真机最后一次错误：`"Stream must be set to true"` → 我切了 `stream:true` + SSE 解析后没再真机验证
- 用户 testing 的 OpenCoworkAI 订阅是 ChatGPT Plus（邮箱 haoqingeric@gmail.com）
