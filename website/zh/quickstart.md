---
title: 快速开始
description: 90 秒在 macOS / Windows / Linux 上跑通 Open CoDesign，渲染第一个 AI 生成原型。
---

# 快速开始

三步让 Open CoDesign 在你的电脑上跑起来。

## 1. 安装

### 用包管理器（推荐）

```sh
# macOS
brew install --cask opencoworkai/tap/open-codesign

# Windows — Scoop
scoop bucket add opencoworkai https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencoworkai/open-codesign
```

Homebrew 和 Scoop 已经更新到 v0.2.0。winget manifest 已提交到 microsoft/winget-pkgs#372310，正在等 Microsoft review；PR 合并前建议先用 Scoop 或直接下载安装包。

### 或者直接下载

从 [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases) 挑对应平台：

| 平台 | 文件 |
|---|---|
| macOS（Apple Silicon）| `open-codesign-*-arm64.dmg` |
| macOS（Intel）| `open-codesign-*-x64.dmg` |
| Windows（x64）| `open-codesign-*-x64-setup.exe` |
| Windows（ARM64）| `open-codesign-*-arm64-setup.exe` |
| Linux（AppImage） | `open-codesign-*-x64.AppImage` |
| Linux（Debian/Ubuntu） | `open-codesign-*-x64.deb` |
| Linux（Fedora/RHEL） | `open-codesign-*-x64.rpm` |

GitHub Releases 是主要下载源。如果 GitHub 下载慢或不可达，可以用 [SourceForge 镜像](https://sourceforge.net/projects/open-codesign.mirror/files/)；安装前请用同一个 GitHub release 里附带的 `SHA256SUMS.txt` 校验下载文件。

::: tip 未签名安装包说明
当前安装包还没有 Apple notarization 和 Windows Authenticode 签名。**macOS Sequoia 15+**：右键 → 打开 已绕不过 Gatekeeper，装完跑一次 `xattr -cr "/Applications/Open CoDesign.app"`（0.1.2 及之前路径是 `/Applications/open-codesign.app`）。**Windows**：SmartScreen → 更多信息 → 仍要运行。希望已验证的构建？从源码自行编译，参见[架构](../architecture)。
:::

## 2. 添加 provider

首次启动会打开设置页面，按你已有的模型入口选择：

- **ChatGPT 订阅登录** — 直接登录 ChatGPT，使用 Codex 模型，无需粘贴 API Key。
- **从 Claude Code 或 Codex 导入** — 一键导入，我们直接读 `~/.codex/config.toml` 和 `~/.claude/settings.json`，把 provider、model、API Key 一次带过来。
- **手动添加** — 粘贴任意 API Key，provider 根据前缀自动识别（`sk-ant-…` → Anthropic，`sk-…` → OpenAI，等等）。
- **Keyless** — IP 白名单代理（企业网关、本地 Ollama），Key 留空即可。

开箱支持：Anthropic Claude、OpenAI GPT、Google Gemini、DeepSeek、OpenRouter、SiliconFlow、本地 Ollama、ChatGPT 订阅登录，以及任何 OpenAI 兼容端点。API Key 凭证通过 Electron `safeStorage` 加密存储于 `~/.config/open-codesign/config.toml`，ChatGPT OAuth token 保存在应用配置目录下的 token store 中，不会上传。

## 3. 输入第一条提示

从 Hub 选一个内置 demo，或者自由描述。现在内置 15 个 demo brief。第一版几秒内就会出现在沙箱 iframe 里——HTML 或实时 React 组件，取决于提示内容。

## 接下来试试

- **行内评论** — 在预览中点击任意元素，留下评论。模型只重写该区域。
- **可调滑块** — 模型主动给出值得调的参数（颜色、间距、字体），拖动即可微调，无需重发提示。
- **切换设计** — 最近 5 个设计的预览 iframe 常驻内存，切换零延迟。
- **导出** — HTML、PDF（本机 Chrome）、PPTX、ZIP、Markdown，全部本地生成。

## 从源码构建

```bash
git clone https://github.com/OpenCoworkAI/open-codesign.git
cd open-codesign
pnpm install
pnpm dev
```

需要 Node 22 LTS 与 pnpm 9.15+。仓库结构参见[架构](../architecture)。

## 继续阅读

- [架构](../architecture) — 包如何组合。
- [路线图](../roadmap) — 按版本规划。
- [GitHub Issues](https://github.com/OpenCoworkAI/open-codesign/issues) — 报 bug 或提需求。
