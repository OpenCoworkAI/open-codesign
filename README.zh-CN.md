# Open CoDesign

**English**: [README.md](./README.md)

> 你的提示词，你的模型，你的电脑。
>
> Open CoDesign 是一个开源、Local-first 的 AI 设计工具，可以把一句提示词直接变成精致的 HTML 原型、幻灯片和营销素材。

[官网](https://opencoworkai.github.io/open-codesign/) · [快速开始](#快速开始) · [更新日志](./CHANGELOG.md) · [最新发版](https://github.com/OpenCoworkAI/open-codesign/releases) · [社区讨论](https://github.com/OpenCoworkAI/open-codesign/discussions) · [对比 Claude Design](https://opencoworkai.github.io/open-codesign/claude-design-alternative) · [文档](https://opencoworkai.github.io/open-codesign/quickstart) · [参与贡献](./CONTRIBUTING.md) · [安全说明](./SECURITY.md)

<p align="center">
  <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/product-hero.png" alt="Open CoDesign：左边是提示词，右边是实时生成的设计结果" width="1000" />
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OpenCoworkAI/open-codesign?label=release&color=c96442" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/OpenCoworkAI/open-codesign/ci.yml?label=CI" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/OpenCoworkAI/open-codesign?style=social" /></a>
  <a href="#%E7%A4%BE%E7%BE%A4"><img alt="微信用户群" src="https://img.shields.io/badge/%E5%BE%AE%E4%BF%A1-%E7%94%A8%E6%88%B7%E7%BE%A4-07C160?logo=wechat&logoColor=white" /></a>
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/commits/main"><img alt="最近提交" src="https://img.shields.io/github/last-commit/OpenCoworkAI/open-codesign?label=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4&color=40b4a1" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/pulse"><img alt="月提交量" src="https://img.shields.io/github/commit-activity/m/OpenCoworkAI/open-codesign?label=%E6%9C%88%E6%8F%90%E4%BA%A4" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/graphs/contributors"><img alt="贡献者" src="https://img.shields.io/github/contributors/OpenCoworkAI/open-codesign?label=%E8%B4%A1%E7%8C%AE%E8%80%85" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="下载量" src="https://img.shields.io/github/downloads/OpenCoworkAI/open-codesign/total?label=%E4%B8%8B%E8%BD%BD%E9%87%8F&color=6c5ce7" /></a>
</p>

<p align="center">
  <sub><code>ai-design</code> · <code>claude-design-alternative</code> · <code>v0-alternative</code> · <code>bolt-alternative</code> · <code>lovable-alternative</code> · <code>prompt-to-design</code> · <code>ai-prototyping</code> · <code>desktop-design-tool</code> · <code>byok</code> · <code>local-first</code> · <code>electron</code> · <code>multi-model</code> · <code>open-source</code></sub>
</p>

---

## 最近更新

- **v0.2.0** *（准备中，预计一周左右发布）* — Agentic Design：带真实工作区的设计会话 · 带权限的文件 / 工具循环 · 按需加载 skill 和 scaffold · `DESIGN.md` 设计系统
- **v0.1.4** *（2026-04-23）* — AI 图像生成 · 支持 ChatGPT Plus / Codex 订阅登录 · CLIProxyAPI 一键导入 · API 配置稳定性优化
- **v0.1.3** *（2026-04-21）* — 修复 Gemini `models/` 前缀 key · 修复 OpenAI 兼容中转 "instructions required" 报错 · 新增第三方中转 SSE 截断提示
- **v0.1.2** *（2026-04-21）* — 发版流程 · Homebrew / winget / Scoop 打包清单

[查看全部发版记录 →](https://github.com/OpenCoworkAI/open-codesign/releases) · [更新日志 →](./CHANGELOG.md)

---

## 它是什么

Open CoDesign 可以把一句自然语言提示词，直接变成一个完成度很高的 HTML 原型、幻灯片或者营销素材，而且整个过程都可以在你的电脑上完成。

它适合这样一类人：想要 AI 设计工具的速度，但不想被订阅制绑住，不想把工作流全丢到云端，也不想只能用某一家模型。你可以把它理解成一个更开放、更本地化的 Claude Design 替代方案：开源、桌面原生、支持自带 API Key，也支持多模型切换。

---

## 看它怎么生成

从一条空白提示词开始，Agent 会自己规划、生成、检查，然后交给你一个已经带有 hover 状态、tabs、empty states 等细节的完整结果：

![从零开始生成设计](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/generate-from-scratch.gif)

---

## 为什么大家会给它点 star

- **直接跑在你的电脑上**，不是必须依赖云端工作区
- **直接用你自己的模型**，支持 Claude、GPT、Gemini、Ollama、OpenRouter 等
- **导出的是真文件**，不是只能截图或者看预览
- **生成过程看得见**，Agent 在做什么、调了什么、什么时候可以打断，你都知道

---

## 为什么是 Open CoDesign？

如果你想要 AI 设计工具的速度，但又不想把模型选择、数据和工作流都交给单一平台，Open CoDesign 会是一个更自由的选择。

| | **Open CoDesign** | Claude Design | v0 by Vercel | Lovable |
|---|:---:|:---:|:---:|:---:|
| 开源 | ✅ MIT | ❌ 闭源 | ❌ 闭源 | ❌ 闭源 |
| 桌面原生 | ✅ Electron | ❌ 仅 Web | ❌ 仅 Web | ❌ 仅 Web |
| 支持自带 Key | ✅ 任意提供商 | ❌ 仅 Anthropic | ❌ 仅 Vercel | ⚠️ 有限制 |
| 本地 / 离线 | ✅ 本地应用 | ❌ 云端 | ❌ 云端 | ❌ 云端 |
| 模型支持 | ✅ 20+（Claude、GPT、Gemini、Ollama…） | Claude only | GPT-4o | Multi-LLM |
| 版本历史 | ✅ 本地 SQLite 快照 | ❌ | ❌ | ❌ |
| 数据隐私 | ✅ 应用状态保留在本地 | ❌ 云端处理 | ❌ 云端 | ❌ 云端 |
| 可编辑导出 | ✅ HTML、PDF、PPTX、ZIP、Markdown | ⚠️ 有限制 | ⚠️ 有限制 | ⚠️ 有限制 |
| 价格 | ✅ 应用免费，仅承担模型 token 成本 | 💳 订阅制 | 💳 订阅制 | 💳 订阅制 |

---

## 亮点功能

<table>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/comment-mode.png" alt="点击任意元素添加批注，让模型只修改局部区域" />
      </a>
      <p><b>不用重写整段提示词。</b><br/>点一下元素、落一个批注，模型就只改这一块。</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/tweaks-sliders.png" alt="AI 自动生成可调参数面板" />
      </a>
      <p><b>AI 自动生成可调参数。</b><br/>模型会把真正值得调的颜色、间距、字体等参数暴露出来，你可以直接拖动细调，不用重新来一轮。</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/hub-your-designs.png" alt="设计历史与最近生成结果" />
      </a>
      <p><b>每次迭代都会留下来。</b><br/>设计结果会保存在本地，最近几个版本之间可以即时切换。</p>
    </td>
    <td width="50%">
      <a href="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png">
        <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/screenshots/agent-panel.png" alt="实时 Agent 面板" />
      </a>
      <p><b>看着 Agent 干活。</b><br/>Todo、工具调用和实时进度都能看到，而且随时可以打断。</p>
    </td>
  </tr>
</table>

---

## 快速开始

**第一次生成一个结果，大概只要：** 3 分钟

**你需要准备：** 一个 API Key，或者本地 Ollama

**支持平台：** macOS、Windows、Linux

### 1. 安装

**一行命令**（推荐）：

```bash
# Windows
winget install OpenCoworkAI.OpenCoDesign

# macOS
brew install --cask opencoworkai/tap/open-codesign
```

**或从 [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases) 直接下载安装包**（v0.1.x）：

| 平台 | 文件 |
|---|---|
| macOS（Apple Silicon） | `open-codesign-*-arm64.dmg` |
| macOS（Intel） | `open-codesign-*-x64.dmg` |
| Windows（x64） | `open-codesign-*-x64-setup.exe` |
| Windows（ARM64） | `open-codesign-*-arm64-setup.exe` |
| Linux（x64，AppImage） | `open-codesign-*-x64.AppImage` |
| Linux（x64，Debian/Ubuntu） | `open-codesign-*-x64.deb` |
| Linux（x64，Fedora/RHEL） | `open-codesign-*-x64.rpm` |

每个 release 都会附带 `SHA256SUMS.txt` 和 CycloneDX SBOM（`*-sbom.cdx.json`），方便你校验下载内容。

<details>
<summary><b>其他包管理器</b></summary>

| 管理器 | 命令 | 状态 |
|---|---|---|
| Scoop（Windows） | `scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket && scoop install open-codesign` | 🟢 可用 |
| Flathub（Linux） | `flatpak install flathub ai.opencowork.codesign` | ⏸ 延后到 v0.2（需要签名构建 + AppStream 元数据） |
| Snap（Linux） | `snap install --dangerous open-codesign-*.snap` | 🟡 随 release 尽量附带，尚未接入 Snap Store |

每次 tag push 后 CI 会把 SHA 自动写回 `packaging/`，winget PR 合并后后续版本会自动提 bump PR。下游镜像流程见各个 `packaging/*/README.md`。
</details>

> **v0.1 提示：** 当前安装包未签名。**macOS Sequoia 15+** 起，右键 → 打开 已不能绕过 Gatekeeper，即使在「系统设置 → 隐私与安全性」里点"仍要打开"也经常失败。最可靠的一行命令：
>
> ```sh
> xattr -cr "/Applications/Open CoDesign.app"
> ```
>
> 跑完直接双击打开即可。（0.1.x 旧版本装完后路径是 `/Applications/open-codesign.app`。）
> **Windows**：SmartScreen → More info → Run anyway。
>
> 想要可验证构建可以自己从源码编译，见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 2. 添加 API Key

首次启动时，Open CoDesign 会直接打开设置页。你可以粘贴任意支持的 provider key：

- Anthropic（`sk-ant-…`）
- OpenAI（`sk-…`）
- Google Gemini
- 任意 OpenAI 兼容中继，比如 OpenRouter、SiliconFlow、本地 Ollama

凭证会保存在 `~/.config/open-codesign/config.toml`（文件权限 0600，与 Claude Code、Codex、`gh` CLI 的做法一致）。除非你选择的模型提供商本身需要联网，请求内容不会额外离开你的机器。

### 3. 输入第一条提示词

你可以直接选 **十五个内置 demo** 之一，比如 landing page、dashboard、pitch slide、pricing、mobile app、chat UI、event calendar、blog article、receipt/invoice、portfolio、settings panel 等，也可以直接写自己的需求。几秒内，你就能看到一个沙箱中的可交互原型。

---

## 可以直接接你现有的开发环境

如果你已经在用 Claude Code 或 Codex，现有的 provider、model 和 API key 都可以一键导入，不用复制粘贴，也不用重新配一遍。

![一键导入 Claude Code 或 Codex 配置](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/demos/claude-code-import.gif)

---

## 内置设计能力

通用 AI 工具很容易产出“差不多就那样”的设计。Open CoDesign 内置了 **十二个设计技能模块**，包括幻灯片、仪表盘、落地页、SVG 图表、玻璃拟态、编辑风排版、Hero 区块、价格页、页脚、聊天界面、数据表格和日历，同时还有一层内置的设计约束，帮助模型更稳定地做出更讲究的排版、留白和配色。

每次生成时，这些能力都会自动参与。在模型真正开始写 CSS 之前，它会先判断当前需求适合哪些技能，并围绕布局意图、设计系统一致性和对比度做推理，从而让你用任意模型时，都更容易得到像样的设计结果。

如果你想把自己的风格教给模型，只需要在项目里加一个 `SKILL.md`。

---

## 你能得到什么

### 模型与提供商
- **统一的 provider 抽象**：支持 Anthropic、OpenAI、Gemini、DeepSeek、OpenRouter、SiliconFlow、本地 Ollama，以及任意 OpenAI-compatible relay；同时支持无 key 的 IP 白名单代理
- **一键导入 Claude Code 和 Codex 配置**：现有的 provider、model 和 key 可以直接带进来
- **动态模型选择器**：每个 provider 都会展示真实模型列表，而不是一小撮写死的选项

### 生成与编辑
- **提示词 → HTML 或 JSX/React 组件原型**，渲染在隔离的 sandbox iframe 中（本地 vendored React 18 + Babel）
- **十五个内置 demo + 十二个设计技能模块**：给常见设计需求准备好的起点
- **实时 Agent 面板**：模型编辑文件时，工具调用会实时流式展示
- **AI 图像生成**：可选启用，为 hero、产品图、背景和插画生成位图素材
- **AI 自动生成调节参数**：模型会主动暴露值得调的参数，比如颜色、间距和字体
- **Comment mode**：点击预览中的任意元素，留下批注，模型只重写对应局部
- **支持中途取消生成**：停止后也不会丢失之前的上下文和结果

### 预览与工作流
- **手机 / 平板 / 桌面预览**：一键切换真实响应式视图
- **Files 面板**：导出前先检查多文件产物（HTML、CSS、JS）
- **即时设计切换**：最近五个设计会保持 iframe 存活，因此 Hub 和 Workspace 之间切换几乎零延迟
- **连接诊断面板**：一键检测任意 provider 的连接状态，并给出可操作的报错信息
- **每次生成的 token 计数**：侧边栏直接看到这一轮花了多少 token
- **四个设置页签**：Models、Appearance、Storage、Advanced
- **浅色 / 深色主题**，以及 **英文 / 简体中文 UI** 的实时切换

### 导出与发布
- **五种导出格式**：HTML（内联 CSS）、PDF（本地 Chrome）、PPTX、ZIP、Markdown
- **GitHub Release 发布链路**：当前提供未签名的 DMG（macOS）、EXE（Windows）和 AppImage（Linux）；v0.5 会加入代码签名和可选自动更新

---

## Roadmap

当前版本是 v0.1.4，v0.2.0 正在准备中。优先级仍可能调整，但下一版主题已经确定：**Agentic Design**。

### Now — v0.1.4 已发布

- **AI 图像生成**：通过 OpenAI 图像模型或 OpenRouter 图像模型生成位图素材，默认关闭，可在设置里启用
- **ChatGPT Plus / Codex 订阅登录**：一键 OAuth，适合不想手动粘贴 API Key 的用户
- **CLIProxyAPI 一键导入**：自动发现正在运行的本地代理，并带入 Settings
- **API 配置稳定性优化**：对 timeout、SSE 截断、缺少 `/models`、Messages API 不兼容等中转问题给出更清楚的诊断

### Next — v0.2.0（Agentic Design）

预计一周左右发布。v0.2 会把 Open CoDesign 从一次性生成器升级成一个本地设计 agent，每个设计都有真实工作区：

- **Design as session**：每个 design 都是一个 pi session，历史写入 JSONL，产物落在磁盘工作区
- **带权限的 agent loop**：复用 pi 的 read、write、edit、bash、grep、find、ls，由 Open CoDesign 权限 UI 统一拦截
- **按需调用设计工具**：`ask`、`scaffold`、`skill`、`preview`、`gen_image`、`tweaks`、`todos`、`done`
- **`DESIGN.md` 作为设计系统源文件**：品牌 token 和设计决策写成可编辑文件，而不是存在模型记忆里
- **v0.1 迁移路径**：旧 SQLite 设计会迁移到真实工作区和 session history

### Later — v0.2.x 及之后

- 继续打磨新版 `ask`、`preview`、tweaks 和进程管理界面
- 成本透明化：生成前估算 + 每周预算控制（每轮 token 计数已上线）
- 版本快照 + 并排 diff
- 三种风格并行探索
- 从代码库提取设计系统 token
- 代码签名（Apple ID + Authenticode）+ 可选自动更新 — v0.5
- Figma 图层导出 — 1.0 之后

有想优先做的事？欢迎[开 issue](https://github.com/OpenCoworkAI/open-codesign/issues/new/choose) 或给已有的 issue 点个 👍，我们真的会看。

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=OpenCoworkAI/open-codesign&type=Date)](https://star-history.com/#OpenCoworkAI/open-codesign&Date)

---

## 基于这些技术构建

- Electron + React 19 + Vite 6 + Tailwind v4
- `@mariozechner/pi-ai` 与 `pi-coding-agent`（模型 / provider 与 agent loop 基础能力）
- `better-sqlite3`、`electron-builder`

## 社群

Open CoDesign 在 [LINUX DO](https://linux.do/) 社区首发，感谢佬友们的反馈和建议。

- **[GitHub Discussions](https://github.com/OpenCoworkAI/open-codesign/discussions)** — 在 [Show & Tell](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/show-and-tell) 晒你生成的设计，[Q&A](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/q-a) 提使用问题，[Ideas](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/ideas) 提功能建议。
- **[LINUX DO](https://linux.do/)** — 中文讨论、使用心得、反馈（首发社区）。
- **GitHub Issues** — [可复现的 bug 报告](https://github.com/OpenCoworkAI/open-codesign/issues)。

中文用户交流群（微信）：

<p align="center">
  <img src="https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/website/public/community/wechat-group.jpg" alt="Open CoDesign 用户交流群微信二维码" width="260" />
</p>

> ⚠️ 微信群二维码每 7 天自动失效（当前截至 **5 月 4 日** 有效）。扫码失败请到 [GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) 留言，我们会更新这里的图片。

英文或异步讨论：[GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) · 安全问题：[SECURITY.md](./SECURITY.md)。

## 参与贡献

请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。开始写代码前建议先开 issue，提交时需要签 DCO，发 PR 前请先运行 `pnpm lint && pnpm typecheck && pnpm test`。

## 许可证

MIT。你可以 fork、发布、商用。第三方依赖相关声明保留在 [NOTICE](./NOTICE)。

## 如何引用这个项目

如果你在论文、文章或产品对比中引用 Open CoDesign，可以使用下面的格式：

```bibtex
@misc{open_codesign_github,
  author       = {OpenCoworkAI Contributors},
  title        = {Open CoDesign: An Open-Source Desktop AI Design Tool},
  year         = {2026},
  howpublished = {\url{https://github.com/OpenCoworkAI/open-codesign}},
  note         = {GitHub repository}
}
````

或者直接使用仓库根目录下机器可读的 `CITATION.cff`。
