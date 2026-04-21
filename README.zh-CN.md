# Open CoDesign

**English**: [README.md](./README.md)

> 你的提示词。你的模型。你的电脑。Anthropic Claude Design 的自托管替代方案。

[官网](https://opencoworkai.github.io/open-codesign/) · [快速开始](#快速开始) · [对比 Claude Design](https://opencoworkai.github.io/open-codesign/zh/claude-design-alternative) · [贡献指南](./CONTRIBUTING.md) · [安全政策](./SECURITY.md)

<p align="center">
  <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/product-hero.png" alt="Open CoDesign — 左边对话，右边成品" width="1000" />
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OpenCoworkAI/open-codesign?label=release&color=c96442" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/OpenCoworkAI/open-codesign/ci.yml?label=CI" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/OpenCoworkAI/open-codesign?style=social" /></a>
</p>

<p align="center">
  <sub>Topics: <code>ai-design</code> · <code>claude-design-alternative</code> · <code>byok</code> · <code>local-first</code> · <code>electron</code> · <code>multi-model</code> · <code>open-source</code></sub>
</p>

---

## Open CoDesign 是什么？

Open CoDesign 把自然语言提示词变成精美的 HTML 原型、幻灯片或营销素材——完全在你的电脑上运行，使用你已经在付费的任意 AI 模型。把它理解成 Claude Design，但没有订阅锁定、没有云账号要求、没有单一模型的上限。

---

## 一份 design 从无到有

从一条 prompt 到完整 artifact——agent 规划、写代码、自检，最后交回一个 hover / tab / 空状态都已接好的交互式产物：

![从零生成一个 design](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/generate-from-scratch.gif)

---

## 亮点

<table>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png" alt="点击任意元素落 pin，模型只重写该区域" />
      </a>
      <p><b>评论别重写。</b><br/>在预览里点任意元素落 pin，模型只改那一块。</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png" alt="AI 生成的调节面板——色板 + RGB 输入" />
      </a>
      <p><b>AI 调的滑块。</b><br/>模型主动给出值得调的参数，拖动就能微调。</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png" alt="设计主页 — 所有生成过的 artifact" />
      </a>
      <p><b>每次迭代都在。</b><br/>Design 以 SQLite 快照存在磁盘，最近 5 个零延迟切换。</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png" alt="Agent 面板——实时 todos 与流式 tool call" />
      </a>
      <p><b>看 agent 干活。</b><br/>Todos、tool call、流式推理全部可见，随时可打断。</p>
    </td>
  </tr>
</table>

---

## 已经在用 Claude Code 或 Codex？

一键把 providers、models、API keys 全部导入——不用复制粘贴，不用重配设置：

![一键导入 Claude Code 或 Codex 配置](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/claude-code-import.gif)

---

## 为什么选 Open CoDesign？

| | **Open CoDesign** | Claude Design | v0 by Vercel | Lovable |
|---|:---:|:---:|:---:|:---:|
| 开源 | ✅ Apache-2.0 | ❌ 闭源 | ❌ 闭源 | ❌ 闭源 |
| 桌面原生 | ✅ Electron | ❌ 仅 Web | ❌ 仅 Web | ❌ 仅 Web |
| 自带密钥 | ✅ 任意 provider | ❌ 仅 Anthropic | ❌ 仅 Vercel | ⚠️ 有限 |
| 本地 / 离线 | ✅ 完全本地 | ❌ 云端 | ❌ 云端 | ❌ 云端 |
| 可用模型 | ✅ 20+（Claude / GPT / Gemini / Ollama…） | 仅 Claude | GPT-4o | 多 LLM |
| 版本历史 | ✅ 本地 SQLite 快照 | ❌ | ❌ | ❌ |
| 数据隐私 | ✅ 100% 设备本地 | ❌ 云端处理 | ❌ 云端 | ❌ 云端 |
| 价格 | ✅ 免费，仅 token 费用 | 💳 订阅制 | 💳 订阅制 | 💳 订阅制 |

---

## 快速开始

### 1. 安装

**包管理器**（推荐）：

```sh
# macOS — Homebrew
brew tap OpenCoworkAI/tap
brew install --cask open-codesign

# Windows — winget
winget install OpenCoworkAI.open-codesign

# Windows — Scoop
scoop bucket add opencowork https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencowork/open-codesign
```

**直接下载** 从 [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases)：

| 平台 | 文件 |
|---|---|
| macOS（Apple Silicon）| `open-codesign-*-arm64.dmg` |
| macOS（Intel）| `open-codesign-*.dmg` |
| Windows（x64 / arm64）| `open-codesign-*-setup.exe` |
| Linux | `open-codesign-*.AppImage` |

> **v0.1 说明：** 安装包暂未签名。macOS：右键 → 打开，或安装后在终端执行 `xattr -d com.apple.quarantine /Applications/open-codesign.app`。Windows：SmartScreen → 更多信息 → 仍要运行。
> 需要已验证的构建？请从源码自行编译，参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 2. 添加 API Key

首次启动会打开设置页面。粘贴任意 provider 的密钥：

- Anthropic（`sk-ant-…`）
- OpenAI（`sk-…`）
- Google Gemini
- 任意 OpenAI 兼容端点（OpenRouter、SiliconFlow、本地 Ollama）

凭证通过 Electron `safeStorage` 加密，存储在 `~/.config/open-codesign/config.toml`。没有任何内容离开你的设备。

### 3. 输入第一个提示词

从**十五个内置 demo** 中选一个——落地页、仪表盘、演讲幻灯片、定价、移动应用、聊天 UI、事件日历、博客文章、发票、作品集、设置面板等等——或者自由描述你的想法。沙箱原型几秒内就会出现。

---

## 内置 Anthropic 风格的设计智能

通用 AI 工具产出通用结果。Open CoDesign 内置 **12 个设计 skill 模块**——幻灯片、仪表盘、落地页、SVG 图表、玻璃质感、编辑排版、Hero、定价、页脚、聊天 UI、数据表格、日历——还有一套**反 AI 糟粕设计 Skill**，引导模型走向深思熟虑的排版、有意义的留白和有目的的配色，而不是每个产物都用 `#3B82F6` 蓝色按钮。

每个 skill 都已经在每次生成中生效。在模型写出一行 CSS 之前，它会先挑选适合的 skill，再推理布局意图、设计系统连贯性和对比度——这和 Claude Design 最优秀产出背后的编辑纪律一致，适用于你带来的任何模型。

在任何项目中添加 `SKILL.md`，即可教会模型你自己的审美。

---

## 当前已实现功能

- **统一 provider 模型** — Anthropic、OpenAI、Gemini、DeepSeek、OpenRouter、SiliconFlow、本地 Ollama，或任意 OpenAI 兼容中继；支持 keyless（IP 白名单）代理
- **Claude Code / Codex 配置一键导入** — 把已有的 provider、model、API Key 一次带过来
- **动态 model 选择器** — 每个 provider 显示自己真实的模型目录，不再写死
- **提示词 → HTML 或 JSX/React 组件**原型，在沙箱 iframe 中渲染（vendored React 18 + Babel，全在本机）
- **15 个内置 demo + 12 个设计 skill 模块** — 覆盖常见设计命题的即用起点
- **实时 agent 面板** — 模型调用工具写文件时的 tool call 流实时可见
- **AI 生成滑块** — 模型主动给出值得调整的参数（颜色、间距、字体），拖动即可零往返微调
- **评论模式** — 在预览中点击任意元素落一枚 pin 留下评论，模型只重写该区域
- **手机 / 平板 / 桌面预览** — 真实响应式框，一键切换
- **文件面板** — 导出前检查多文件 artifact（HTML、CSS、JS）
- **设计间切换瞬答** — 最近 5 个 design 的预览 iframe 常驻内存，Hub ↔ 工作区、侧栏切换都是零延迟
- **连接诊断面板** — 任意 provider 一键测试，附可操作的错误信息
- **浅色 + 深色主题**，**EN + 简体中文** 界面，支持实时切换
- **五种导出格式** — HTML（内联 CSS）、PDF（本机 Chrome）、PPTX、ZIP、Markdown
- **生成取消** — 随时打断流式输出，之前的轮次不丢失
- **每次生成的 token 计数** — Sidebar 直接显示每轮消耗的 token 数
- **设置页面四个 tab** — Models（provider + key）、Appearance（主题 / 语言）、Storage（配置与数据路径）、Advanced（更新通道）
- **GitHub Release 流水线** — 未签名 DMG（macOS）、EXE（Windows）、AppImage（Linux）。代码签名 + 可选自动更新将在 v0.5 引入。

---

## 路线图

| 功能 | 状态 |
|---|---|
| 多 provider 入门 + 设置 | ✅ 已上线 |
| Claude Code / Codex 一键配置导入 | ✅ 已上线 |
| 每 provider 动态 model 选择器 | ✅ 已上线 |
| Keyless（IP 白名单）代理支持 | ✅ 已上线 |
| 提示词 → HTML 原型（沙箱 iframe） | ✅ 已上线 |
| 提示词 → JSX/React 组件（本机 React 18 + Babel） | ✅ 已上线 |
| 实时 agent 活动面板（流式 tool call） | ✅ 已上线 |
| AI 生成可调滑块 | ✅ 已上线 |
| 评论模式（pin + AI 局部重写） | ✅ 已上线 |
| 设计间切换瞬答（预览 pool） | ✅ 已上线 |
| 双语界面（EN + 简体中文） | ✅ 已上线 |
| HTML 导出（内联 CSS） | ✅ 已上线 |
| PDF 导出（本机 Chrome） | ✅ 已上线 |
| PPTX 导出 | ✅ 已上线 |
| ZIP / Markdown 导出 | ✅ 已上线 |
| 成本透明（生成前 token 估算 + 周预算，每次生成 token 数已上线） | 🔜 即将推出 |
| 版本快照 + 并排 diff | 🔜 即将推出 |
| 代码库 → 设计系统（token 提取） | 🔜 即将推出 |
| 三风格并发探索 | 🔜 即将推出 |
| 代码签名（Apple ID + Authenticode）+ 可选自动更新 | 🔜 v0.5 |
| Figma 图层导出 | 🔜 1.0 版本后 |

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=OpenCoworkAI/open-codesign&type=Date)](https://star-history.com/#OpenCoworkAI/open-codesign&Date)

---

## 引用本项目

如果你在论文、文章或产品对比中引用 Open CoDesign，请使用：

```
OpenCoworkAI (2026). open-codesign: Open-source desktop AI design tool.
GitHub. https://github.com/OpenCoworkAI/open-codesign
Apache-2.0 License.
```

或使用仓库根目录的机器可读 `CITATION.cff`。

---

## 技术栈

- Electron + React 19 + Vite 6 + Tailwind v4
- `@mariozechner/pi-ai`（多 provider 模型抽象层）
- `better-sqlite3`、`electron-builder`

## 贡献

请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。写代码前先开 Issue，提交需附 DCO 签名，提 PR 前运行 `pnpm lint && pnpm typecheck && pnpm test`。

## 许可证

Apache-2.0 — 可 Fork、可商用、可分发。保留 [NOTICE](./NOTICE) 即可。
