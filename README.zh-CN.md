# Open CoDesign

**English**: [README.md](./README.md)

> 开源 AI 设计工具——把自然语言变成可点击的原型、幻灯片和营销素材。多模型支持，BYOK，跑在你自己的电脑上。

[项目愿景](./docs/VISION.md) · [路线图](./docs/ROADMAP.md) · [官网](https://opencoworkai.github.io/open-codesign/) · [贡献指南](./CONTRIBUTING.md) · [协作方式](./docs/COLLABORATION.md)

---

**状态**：🚧 Pre-alpha——正在公开设计阶段，暂不可用。

Open CoDesign 是一款开源桌面应用，把自然语言提示词转化为 HTML 原型、PDF 单页文档、PPTX 演示文稿和符合设计规范的界面稿。它是 Claude Design 的开源对应版本，支持多家模型提供商，数据本地优先存储。

## 为什么做这个

- **多模型**：Anthropic、OpenAI、Gemini、DeepSeek、本地模型——带上你自己的 key。
- **本地优先**：你的提示词、设计稿和代码库扫描结果默认不离开你的电脑，除非你主动选择同步。
- **轻量**：目标安装体积 ≤ 80 MB。不打包任何运行时，默认无遥测。
- **生态兼容**：设计完成后可顺畅移交给 [open-cowork](https://github.com/OpenCoworkAI/open-cowork) 继续工程化，也与 Claude Artifacts 互通。

## 安装

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

## 状态与路线图

详见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。MVP 成功标准：复现所有公开的 Claude Design 演示效果。

## 许可证

Apache-2.0
