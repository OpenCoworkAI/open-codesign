# Open CoDesign

**English**: [README.md](./README.md)

> 你的提示词。你的模型。你的电脑。Anthropic Claude Design 的开源替代。

[官网](https://opencoworkai.github.io/open-codesign/) · [快速开始](#快速开始) · [贡献指南](./CONTRIBUTING.md) · [安全政策](./SECURITY.md)

<p align="center">
  <img src="https://placehold.co/1200x600/E8E5DE/0E0E10?text=open-codesign+demo" alt="Open CoDesign — 提示词到原型（演示即将上线）" width="900" />
  <!-- Hero 占位（placehold.co）— 正式发布前替换为真实截图 -->
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OpenCoworkAI/open-codesign?label=release&color=c96442" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/OpenCoworkAI/open-codesign/ci.yml?label=CI" /></a>
</p>

---

## Open CoDesign 是什么？

Open CoDesign 把自然语言提示词变成精美的 HTML 原型、幻灯片或营销素材——完全在你的电脑上运行，使用你已经在付费的任意 AI 模型。把它理解成 Claude Design，但没有订阅锁定、没有云账号要求、没有单一模型的上限。

---

## 快速演示（60 秒）

_演示视频即将上线。_

![几秒内从提示词到原型](https://placehold.co/800x450/f5f0eb/c96442?text=演示+GIF+即将上线)
<!-- 发布前替换为真实 GIF -->

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

### 1. 下载安装包

从 [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases) 下载：

| 平台 | 文件 |
|---|---|
| macOS（Apple Silicon）| `open-codesign-*-arm64.dmg` |
| macOS（Intel）| `open-codesign-*-x64.dmg` |
| Windows | `open-codesign-*-Setup.exe` |
| Linux | `open-codesign-*.AppImage` |

> **v0.1 说明：** 安装包暂未签名。macOS：右键 → 打开。Windows：更多信息 → 仍要运行。
> 需要已验证的构建？请从源码自行编译，参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 2. 添加 API Key

首次启动会打开设置页面。粘贴任意 provider 的密钥：

- Anthropic（`sk-ant-…`）
- OpenAI（`sk-…`）
- Google Gemini
- 任意 OpenAI 兼容端点（OpenRouter、SiliconFlow、本地 Ollama）

凭证通过 Electron `safeStorage` 加密，存储在 `~/.config/open-codesign/config.toml`。没有任何内容离开你的设备。

### 3. 输入第一个提示词

从八个内置 demo 中选一个，或者自由描述你的想法。沙箱原型几秒内就会出现。

---

## 内置 Anthropic 风格的设计智能

通用 AI 工具产出通用结果。Open CoDesign 内置**反 AI 糟粕设计 Skill**——一套精心打磨的指令集，引导模型走向深思熟虑的排版、有意义的留白和有目的的配色，而不是每个产物都用 `#3B82F6` 蓝色按钮。

这个 Skill 的第一版已经在每次生成中生效。在模型写出一行 CSS 之前，它会先推理布局意图、设计系统连贯性和对比度——这和 Claude Design 最优秀产出背后的编辑纪律一致，适用于你带来的任何模型。

在任何项目中添加 `SKILL.md`，即可教会模型你自己的审美。

---

## 当前已实现功能

- 多 provider 入门流程 — Anthropic、OpenAI 及任意 OpenAI 兼容端点
- 提示词 → HTML 原型，在沙箱 iframe 中渲染
- AI 生成滑块：模型主动给出值得调整的参数（颜色、间距、字体），拖动即可微调
- 内联注释：在预览中点击任意元素，留下评论，模型只重写该区域
- HTML 导出（内联 CSS）
- 生成取消
- 设置页面，支持各 provider 独立 API Key 管理
- GitHub Release 流水线（macOS DMG、Windows EXE、Linux AppImage）

---

## 路线图

| 功能 | 状态 |
|---|---|
| 多 provider 入门 + 设置 | ✅ 已上线 |
| 提示词 → HTML 原型（沙箱 iframe） | ✅ 已上线 |
| AI 生成可调滑块 | ✅ 已上线 |
| 内联注释 → AI 修补 | ✅ 已上线 |
| HTML 导出（内联 CSS） | ✅ 已上线 |
| 成本透明（token 估算 + 每周花费） | 🔜 即将推出 |
| 版本快照 + 并排 diff | 🔜 即将推出 |
| 代码库 → 设计系统（token 提取） | 🔜 即将推出 |
| 三风格并发探索 | 🔜 即将推出 |
| PPTX 导出 | 🔜 即将推出 |
| PDF 导出 | 🔜 即将推出 |
| 代码签名（Apple ID + Authenticode）| 🔜 Stage 2 |
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
