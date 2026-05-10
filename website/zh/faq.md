---
title: 常见问题
titleTemplate: 常见问题 — Open CoDesign
description: Open CoDesign 常见问题——开源桌面 AI 设计工具，Claude Design、v0、Bolt.new、Lovable、Figma AI 的开源替代方案。BYOK、本地优先、MIT 开源。
head:
  - - meta
    - property: og:type
      content: article
---

# 常见问题

Open CoDesign 用户最常问到的问题。如果这里没有你的答案，可以查看 [快速开始](/zh/quickstart) 或在 [GitHub Discussions](https://github.com/OpenCoworkAI/open-codesign/discussions) 提问。

## Open CoDesign 是什么？

Open CoDesign 是一款开源的桌面 AI 设计工具。它把自然语言提示词转换为 HTML 原型、React 组件、幻灯片、PDF 和营销素材。它是 Anthropic Claude Design、Vercel v0、StackBlitz Bolt.new、Lovable 的开源替代方案——但完全运行在你的本机，可使用你自己的 API Key、本地模型端点或 ChatGPT 订阅登录。

## Open CoDesign 是 Claude Design 的开源替代品吗？

是的。Open CoDesign 是 MIT 协议下、开源的 Anthropic Claude Design 替代方案。它完全运行在桌面端，通过 BYOK（自带 API Key）、本地端点或 ChatGPT 订阅登录支持多种 AI 模型，不需要 OpenCoworkAI 托管账号。仓库地址：[github.com/OpenCoworkAI/open-codesign](https://github.com/OpenCoworkAI/open-codesign)。

## Open CoDesign 和 Vercel v0 比怎么样？

Open CoDesign 能从提示词生成 React / JSX 组件和 HTML 原型——核心能力和 v0 一样。区别在于：

- **开源 vs 闭源。** Open CoDesign 是 MIT 协议，v0 闭源。
- **你的模型 vs 他们的模型。** Open CoDesign 支持 Claude、GPT、Gemini、DeepSeek、Kimi、GLM、Qwen、Ollama，以及任意 OpenAI 兼容的接口。v0 只能用 Vercel 托管的 OpenAI 模型。
- **本地 vs 云端。** Open CoDesign 完全跑在桌面端，v0 跑在 Vercel 云上。
- **你拥有的文件 vs 他们平台上的预览。** Open CoDesign 产出可导出的 HTML / React / PDF / PPTX / ZIP 文件，v0 产出绑定 Vercel 平台的预览。

## Open CoDesign 和 Bolt.new 比怎么样？

Bolt.new 是基于浏览器的全栈应用构建器，跑在 StackBlitz 的 WebContainer 里。Open CoDesign 是聚焦设计产物（原型、幻灯片、营销素材）的桌面应用。区别在于：

- **桌面应用 + 持久化本地存储**（Open CoDesign）vs **浏览器沙盒**（Bolt.new）
- **任意 LLM via BYOK**（Open CoDesign）vs **仅 Anthropic Claude**（Bolt.new）
- **设计产物**（Open CoDesign）vs **完整可运行应用**（Bolt.new）
- **磁盘上的文件**（Open CoDesign）vs **WebContainer 内的文件**（Bolt.new）

## Open CoDesign 和 Lovable 比怎么样？

- **开源**（Open CoDesign，MIT）vs **闭源**（Lovable）
- **本地优先**（Open CoDesign）vs **云端托管**（Lovable）
- **只付 provider 或已有订阅成本**（Open CoDesign）vs **按用量计费的订阅**（Lovable）
- **设计优先的原型**（Open CoDesign）vs **端到端产品打造，集成 Supabase**（Lovable）

## Open CoDesign 和 Figma AI / Figma Make 比怎么样？

它们解决的是不同层面的问题。Figma AI 在 Figma 画布内工作，产出设计稿。Open CoDesign 产出代码原生的产物——HTML、React / JSX、PDF、PPTX——不依赖任何专有设计平台。两者互补，不是直接替代关系。如果你需要能干净交付给工程团队的设计，Open CoDesign 的产出本身就是代码。

## Open CoDesign 收费吗？

不收费。Open CoDesign 是 MIT 协议的开源软件，应用本身可免费下载、使用、修改、分发。你只需要为自己选择的模型入口付费，比如 provider token 成本或已有的 ChatGPT 订阅——我们不收订阅费，也不在 token 上加价。

## 我能用我的 Claude Code 或 Codex 配置吗？

可以。Open CoDesign 会读取你已有的 `~/.claude/settings.json` 和 `~/.codex/config.toml`，一键导入 API key 形式的 provider、model 和 key。如果 Codex 使用的是 ChatGPT 订阅登录，请在 Open CoDesign 里直接使用 ChatGPT 登录，而不是把它导入成 API key provider。应用会直接调用你选择的模型入口——没有代理层，也没有服务端存储。

## 我能用 ChatGPT Plus 或 Codex 订阅登录代替 API Key 吗？

可以。Open CoDesign 支持 ChatGPT Plus / Pro / Team 订阅登录，可用于 Codex 模型和图像生成。一键完成，无需 API Key。

## Open CoDesign 会把我的提示词或设计发给第三方吗？

不会。设计、提示词和扫描结果都存在你本机。v0.2 使用 JSONL 保存 design session，并把生成源码放在真实工作区文件里，配置文件在 `~/.config/open-codesign/config.toml`。唯一的对外网络流量就是直接发给你配置的模型入口，例如 provider API、本地网关或 ChatGPT 订阅端点。默认零遥测。

## Open CoDesign 支持哪些 AI 模型？

- **Anthropic Claude**（Opus、Sonnet、Haiku，全版本）
- **OpenAI GPT**（GPT-5.4、GPT-4o、GPT-4 Turbo、O1、O3、O4）
- **Google Gemini**（包括带 `models/` 前缀的第三方中转）
- **DeepSeek**（V3、R1）
- **OpenRouter**（平台上所有模型）
- **SiliconFlow**（Qwen、Kimi、GLM 等中文模型）
- **Kimi**（Moonshot）
- **GLM**（智谱）
- **Qwen**（阿里）
- **Ollama**（任意本地模型）
- **任意 OpenAI 兼容接口**——覆盖企业内部代理、网关服务、CLIProxyAPI、自托管中转。

也支持无 Key 的（IP 白名单）企业代理，以及 ChatGPT Plus / Codex 订阅登录。

## 支持哪些操作系统？

- **macOS**——Apple Silicon（M1 / M2 / M3 / M4）和 Intel
- **Windows**——x64 和 ARM64
- **Linux**——AppImage、`.deb`（Debian / Ubuntu）、`.rpm`（Fedora / RHEL）

PDF 导出（依赖本机 Chrome）、PPTX 生成等重型功能首次使用时按需加载，基础安装包保持精简。

## 怎么安装？

最快方式：用包管理器。

```bash
# macOS
brew install --cask opencoworkai/tap/open-codesign

# Windows
scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencoworkai/open-codesign
```

或者直接到 [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases) 下载安装包。每个版本都附带 `SHA256SUMS.txt` 和 CycloneDX SBOM 供校验。winget 包已经提交，正在等 Microsoft review；合并后 `winget install OpenCoworkAI.OpenCoDesign` 才会成为可用的一行命令。

## Open CoDesign 能离线使用吗？

能，配合 Ollama 等本地模型运行时。所有生成都走同一套 OpenAI 兼容接口抽象，所以本地模型和云端模型在应用看来表现一致。应用本身安装后不需要联网；只有调用模型时需要对应提供商所需的网络。

## 能产出什么样的输出？

- **HTML 原型**——沙盒 iframe，CSS 内联，无外部运行时依赖。可作为单文件部署。
- **React / JSX 组件**——内置 React 18 + Babel，本地渲染。可复制粘贴到你的项目里。
- **幻灯片**——通过 `pptxgenjs` 生成 PPTX，PowerPoint / Keynote 可编辑。
- **PDF 单页**——通过 Puppeteer-core 调用本机 Chrome 渲染。
- **ZIP 资源包**——HTML + CSS + JS + 资源文件，目录结构确定。可交付给工程团队。
- **Markdown 导出**——带 frontmatter，可被静态站点直接收录。
- **AI 生成的位图素材**——封面图、背景图、插图、Logo，可通过 OpenAI 图像模型、OpenRouter 图像模型或已登录的 ChatGPT 订阅生成。可选启用，默认关闭。

## v0.2 改了什么？

v0.2 是 Agentic Design 大更新。它会把 Open CoDesign 从一次性的提示词转产物生成器，升级成一个本地设计 agent：

- **带真实工作区的 design**——每个 design 都是一个 pi session，历史写入 JSONL，产物落在磁盘文件里
- **带权限的本地工具**——read、write、edit、bash、grep、find、ls 都会经过 Open CoDesign 的权限 UI
- **设计专用工具**——`ask`、`scaffold`、`skill`、`preview`、`gen_image`、`tweaks`、`todos`、`done`
- **预览自检**——agent 可以渲染产物，检查 console / asset 错误；模型支持视觉时还能看截图
- **渐进式技能加载**——skill、scaffold、brand reference 按需加载，而不是全部塞进基础提示词
- **`DESIGN.md` 作为设计系统记忆**——品牌值和 token 写进可编辑文件，而不是靠模型记忆
- **v0.1 迁移路径**——旧 SQLite 设计会迁移到真实工作区和 session history

里程碑计划见 [roadmap](/roadmap)。

## Open CoDesign 安全吗？

安全模型：

- **本地优先。** 设计、提示词、扫描结果不出本机。
- **配置和凭证都保存在本地。** API Key 存在 `~/.config/open-codesign/config.toml`，ChatGPT OAuth token 保存在应用配置目录下的 token store 中。
- **没有代理层。** 你的 API Key 或 ChatGPT OAuth token 直接用于你选择的模型入口。
- **默认零遥测。** 没有分析统计，没有自动更新追踪。
- **每个版本带签名 SBOM。** CycloneDX 供应链清单附在每个 GitHub Release 上。
- **MIT 协议。** 源码自己可审计。

v0.2.0 安装包仍未签名。Apple Developer ID 公证和 Windows Authenticode 签名将在 v0.5 落地。在那之前，仓库里有每个平台可靠的手动安装说明。

## 怎么贡献？

- **报 bug**——开 issue 并附复现步骤。
- **提建议**——用 [GitHub Discussions → Ideas](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/ideas)。
- **提 PR**——读 [CONTRIBUTING.md](https://github.com/OpenCoworkAI/open-codesign/blob/main/CONTRIBUTING.md)。提交带 DCO 签名，跑 `pnpm lint && pnpm typecheck && pnpm test`，加 changeset。
- **晒成果**——发到 [Show & Tell](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/show-and-tell)。优秀作品会被收录到 release notes。

## 在哪里求助？

- [GitHub Discussions → Q&A](https://github.com/OpenCoworkAI/open-codesign/discussions/categories/q-a) ——使用问题
- [GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) ——可复现的 bug
- [LINUX DO](https://linux.do/) ——主要的中文社区
- 微信群 ——二维码见 [README](https://github.com/OpenCoworkAI/open-codesign/blob/main/README.zh-CN.md#community)
