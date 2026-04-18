# Open CoDesign

**English**: [README.md](./README.md)

> 一款开源桌面 AI 设计工具。自带模型，本地优先，一切留在你自己的电脑。

[项目愿景](./docs/VISION.md) · [路线图](./docs/ROADMAP.md) · [官网](https://opencoworkai.github.io/open-codesign/) · [贡献指南](./CONTRIBUTING.md)

---

**状态**：Pre-alpha，正在公开建造中，暂不可用。

Open CoDesign 把自然语言提示词转化为 HTML 原型、幻灯片与营销素材——全部运行在你的电脑上，使用你自己带来的任意模型。它是 Anthropic Claude Design 的开源对照版本，基于三个信念：

1. **你的设计是你的。** 提示词、生成产物与代码库扫描结果存在本地磁盘，默认无云同步，无遥测。
2. **你的模型，你的账单。** 自带 API Key（Anthropic / OpenAI / Google / OpenAI 兼容端点），我们不做代理，不按 token 收费。
3. **你的手艺，被放大。** 生成结果不是黑箱——每个产物都附带值得调整的参数、可对比的版本历史和可复用的设计系统。

## 快速开始

从 [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases) 页面下载最新安装包。

| 平台 | 文件 | 备注 |
|---|---|---|
| macOS（Apple Silicon）| `open-codesign-*-arm64.dmg` | 见下方 Gatekeeper 说明 |
| macOS（Intel）| `open-codesign-*-x64.dmg` | 见下方 Gatekeeper 说明 |
| Windows | `open-codesign-*-Setup.exe` | 见下方 SmartScreen 说明 |
| Linux | `open-codesign-*.AppImage` | 见下方 AppImage 说明 |

**macOS — Gatekeeper 警告（v0.1 未签名）**

因为 v0.1 安装包尚未经过 Apple 公证，macOS 会阻止直接双击打开。解决方法：

1. 右键（或 Control-点击）`.dmg` 文件，选择**打开**。
2. 在弹出的对话框中再次点击**打开**。

每次安装只需操作一次。

**Windows — SmartScreen 警告（v0.1 未签名）**

Windows 可能提示"Windows 已保护你的电脑"。解决方法：

1. 点击**更多信息**。
2. 点击**仍要运行**。

**Linux — AppImage**

```bash
chmod +x open-codesign-*.AppImage
./open-codesign-*.AppImage
```

> **安全说明：** v0.1 二进制文件不带代码签名证书。如果你需要经过验证的构建版本，可以从源码自行编译——参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。代码签名（Apple Developer ID + Windows Authenticode）计划在 Stage 2 加入。

## 为什么选 Open CoDesign

- **多模型，BYOK**：Anthropic、OpenAI、Gemini、DeepSeek，或任意 OpenAI 兼容端点（OpenRouter、SiliconFlow、DuckCoding、本地 Ollama）。在设置里切换 provider。
- **本地优先**：SQLite 存设计历史，加密 TOML 存密钥。永远不依赖云服务。
- **轻量**：安装体积 ≤ 80 MB。不打包 Chromium 运行时，不内置遥测。
- **Apache-2.0**：真正的开源。可 Fork、可商用、可分发。保留 NOTICE 即可。

## 状态与路线图

详见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。MVP 成功标准：复现所有公开的 Claude Design 演示效果。

## 许可证

Apache-2.0
