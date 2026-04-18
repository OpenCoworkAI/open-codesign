---
layout: home
title: Open CoDesign
titleTemplate: 开源 AI 设计工具 — 自带密钥，本地优先，Apache-2.0
description: Open CoDesign 是一款开源桌面 AI 设计工具。自带 API Key（Anthropic、OpenAI、Gemini、Ollama），一切本地运行。Anthropic Claude Design 的开源替代方案。

hero:
  name: Open CoDesign
  text: 用心设计。
  tagline: 一个开源的桌面 AI 设计工具。自带模型，本地优先。Anthropic Claude Design 的开源替代。
  image:
    src: /hero.png
    alt: Open CoDesign — 提示词到原型
  actions:
    - theme: brand
      text: 下载 macOS 版
      link: https://github.com/OpenCoworkAI/open-codesign/releases
    - theme: alt
      text: 在 GitHub 上 Star
      link: https://github.com/OpenCoworkAI/open-codesign
    - theme: alt
      text: 快速开始（90 秒）
      link: /zh/quickstart

features:
  - icon: 🪶
    title: 自带模型
    details: Anthropic、OpenAI、Gemini、DeepSeek，或任意 OpenAI 兼容端点。在设置里切换 provider，我们不做代理，也不按 token 计费。
  - icon: 🏡
    title: 你的电脑就是云
    details: 设计稿、提示词、代码库扫描——SQLite 加密 TOML，全在本地磁盘。无需注册账号，默认无遥测。100% 本地。
  - icon: 🎚️
    title: AI 生成的滑块
    details: 模型主动给出值得调的参数——颜色、间距、字体——拖一下即可微调，不用每次重新发送提示。
  - icon: 🪄
    title: Skills，而非魔法
    details: 内置反 AI 糟粕设计 Skill。添加你自己的 SKILL.md，教会模型你的审美。不再有千篇一律的产出。
  - icon: 🧬
    title: 代码库 → 设计系统
    details: 指向本地仓库，我们抽取 Tailwind token、CSS 变量和 W3C 设计 token——之后每次生成都自动遵循。即将推出。
  - icon: 📐
    title: 版本、对比、快照
    details: 每一次迭代都是一个快照。并排 diff 两个版本，回滚，分支。这是 Claude Design 没有的历史记录。即将推出。
  - icon: 💸
    title: 成本透明
    details: 生成前显示 token 估算，工具栏显示本周花费。设置预算，超出前收到提醒，不再有意外账单。即将推出。
  - icon: 🚢
    title: 三种导出，真实文件
    details: HTML（内联 CSS）今日可用。PDF（Playwright）和 PPTX（pptxgenjs）即将推出。全部本地生成，无需绕道 Canva。
---

<div class="codesign-section">

## 工作流

<div class="codesign-steps">
  <div class="codesign-step">
    <span class="num">1</span>
    <h3>带上你自己的密钥</h3>
    <p>Anthropic、OpenAI、Gemini、DeepSeek、OpenRouter、Ollama——只要 <code>pi-ai</code> 支持，全都能用。</p>
  </div>
  <div class="codesign-step">
    <span class="num">2</span>
    <h3>写一段提示</h3>
    <p>用八个内置 demo，或者自由描述。第一版几秒内出现在沙箱 iframe 里。</p>
  </div>
  <div class="codesign-step">
    <span class="num">3</span>
    <h3>打磨、导出、交付</h3>
    <p>元素级评论、AI 滑块、版本时间线。导出 HTML，PDF/PPTX 即将推出。</p>
  </div>
</div>

</div>

<div class="codesign-section">

## 与同类产品对比

<p class="lede">我们不比 Claude Design 更快，我们走的是另一条路：开源、多模型、本地优先。适合无法接受订阅锁定或云端数据暴露的团队。</p>

<div class="codesign-comparison">

|                       | 开源           | 模型                 | 本地运行  | 价格                 |
| --------------------- | :------------: | :------------------: | :-------: | :------------------: |
| **Open CoDesign**     | **Apache-2.0** | **任意（自带密钥）** | **✓**     | **仅 token 成本**    |
| Claude Design         | ✗ 闭源         | 仅 Opus              | ✗         | 订阅                 |
| v0 by Vercel          | ✗ 闭源         | 平台精选             | ✗         | 订阅                 |
| Lovable               | ✗ 闭源         | 平台精选             | ✗         | 订阅                 |
| Bolt.new              | 部分开源       | 平台精选             | ✗         | 订阅                 |

</div>

</div>

<div class="codesign-section">

## 来自社区

<div class="codesign-proof">
  <p class="proof-placeholder">⭐ <strong>在 GitHub 上 Star 我们</strong> — 每一个 Star 都让更多人能找到这个开放替代。</p>
  <!-- 待替换为真实社区评价：Star 数量、用户引语、HN/PH 提及 -->
</div>

</div>

<div class="codesign-cta">

### 准备好不被任何厂商锁住了吗？

<a href="/open-codesign/zh/quickstart" class="cta-primary">90 秒上手 →</a>
<a href="https://github.com/OpenCoworkAI/open-codesign" class="cta-secondary">在 GitHub 查看</a>

</div>
