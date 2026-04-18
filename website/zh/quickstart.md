---
title: 快速开始
description: 90 秒安装 open-codesign，跑通你的第一个设计。
---

# 快速开始

> open-codesign 处于 pre-alpha 阶段。安装包计划在 v0.5 提供，目前先从源码运行。

## 1. 克隆并安装

```bash
git clone https://github.com/OpenCoworkAI/open-codesign.git
cd open-codesign
pnpm install
```

## 2. 配置 API 密钥

新建 `~/.config/open-codesign/config.toml`：

```toml
schemaVersion = 1

[providers.anthropic]
key = "sk-ant-…"

# 也可以用任意 OpenAI 兼容端点
# [providers.openrouter]
# key  = "sk-or-…"
# base = "https://openrouter.ai/api/v1"
```

provider 会根据密钥前缀自动识别。没有后端、没有遥测、没有云账号。

## 3. 启动桌面壳

```bash
pnpm dev
```

Electron 窗口会带着八个内置 demo 启动，点 **Calm Spaces** 走通第一个端到端流程。

## 4. 之后能做什么

- 在预览里点中元素、留下评论，模型只重写那一块。
- 拖动 AI 给出的滑块，无需重新提示就能调出新的色彩、间距与字体。
- 把代码库扫描器指向你的某个仓库，我们抽取 token 后所有后续生成都自动套用。
- 从分享菜单导出 PDF 或 PPTX（按需懒加载，不会拖慢冷启动）。

## 继续阅读

- [架构](../architecture)
- [路线图](../roadmap)
- [愿景文档](https://github.com/OpenCoworkAI/open-codesign/blob/main/docs/VISION.md)
