---
layout: home
title: Open CoDesign
titleTemplate: 开源 AI 设计工具 — 自带密钥，本地优先，Apache-2.0
description: Open CoDesign 是一款开源桌面 AI 设计工具，Claude Design 的自托管替代方案。自带 API Key（Anthropic、OpenAI、Gemini、DeepSeek、Ollama），一切本地运行。Apache-2.0。

hero:
  name: Open CoDesign
  text: 用心设计。
  tagline: 开源桌面 AI 设计工具。自带模型、本地运行——Claude Design 的自托管替代方案，给无法接受订阅锁定的团队。
  image:
    src: /logo-hero.png
    alt: Open CoDesign — 开源 AI 设计工具
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
    details: Anthropic、OpenAI、Gemini、DeepSeek、OpenRouter、SiliconFlow、本地 Ollama，或任意 OpenAI 兼容中继——包括 keyless（IP 白名单）代理。设置里切 provider，我们不做代理，也不按 token 计费。
  - icon: ⚡
    title: 一键导入配置
    details: 已经在用 Claude Code 或 Codex？Open CoDesign 直接读你的配置文件——provider、model、API Key，一次带过来。
  - icon: 🏡
    title: 你的电脑就是云
    details: 设计稿、提示词、代码库扫描——SQLite 加密 TOML，全在本地磁盘。无需注册账号，默认无遥测。100% 本地。
  - icon: 🪄
    title: 12 个设计 Skill 开箱即用
    details: 内置 12 个设计 skill 模块——仪表盘、落地页、幻灯片、定价页、聊天 UI、数据表格、日历、玻璃质感、编辑排版等等。在任何项目添加你自己的 SKILL.md，教会模型你的审美。
  - icon: 🎚️
    title: AI 生成的滑块
    details: 模型主动给出值得调的参数——颜色、间距、字体——拖一下即可微调，不用每次重新发送提示。
  - icon: 💬
    title: 评论别重写
    details: 预览中点击任意元素落一枚 pin，留下注释，模型只重写该区域。不用为了挪一个按钮重新提示整个页面。
  - icon: 🔀
    title: 设计间切换瞬答
    details: 最近 5 个 design 之间切换零延迟。预览 iframe 常驻内存——不重新解析、没白闪、不用等快照重载。
  - icon: 📱
    title: 桌面、平板、手机
    details: 任一设计都能在真实手机框或平板宽度里预览，与完整画布并排查看。导出前先看响应式故事。
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
    title: 五种导出，真实文件
    details: HTML（内联 CSS）、PDF（本机 Chrome）、PPTX、ZIP、Markdown——全部本地生成，无需绕道 Canva。
---

<script setup>
import { withBase } from 'vitepress'
</script>

<div class="codesign-hero-shot">
  <img :src="withBase('/screenshots/product-hero.png')" alt="Open CoDesign — 左侧 chat，右侧 artifact 实时渲染" />
</div>

<SmartDownload />

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
    <p>从 <strong>15 个内置 demo</strong> 里选——落地页、仪表盘、演讲幻灯片、定价页、移动应用、聊天 UI、日历、博客文章、发票、作品集、邮件等等——或自由描述。第一版几秒内出现在沙箱 iframe 里。</p>
  </div>
  <div class="codesign-step">
    <span class="num">3</span>
    <h3>打磨、导出、交付</h3>
    <p>元素级评论、AI 滑块、版本时间线。导出 HTML、PDF、PPTX、ZIP 或 Markdown——全部本地生成。</p>
  </div>
</div>

</div>

<div class="codesign-section">

## 深入看一看

<p class="lede">从首次启动到局部重写——6 个你会真实遇到的画面。</p>

<div class="codesign-gallery">
  <figure>
    <img :src="withBase('/screenshots/comment-mode.png')" alt="评论模式 — 点击任意元素落 pin，模型只重写该区域" />
    <figcaption><b>评论别重写。</b>在预览落 pin，模型只改那一块。</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/tweaks-sliders.png')" alt="AI 生成的调节面板——色板 + RGB 输入" />
    <figcaption><b>AI 调的滑块。</b>模型主动给出值得调的参数，拖动就能微调。</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/agent-panel.png')" alt="Agent 面板——实时 todos 与流式 tool call" />
    <figcaption><b>看 agent 干活。</b>Todos、tool call、流式推理全部可见。</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/hub-your-designs.png')" alt="设计主页 — 所有生成过的 artifact" />
    <figcaption><b>每次迭代都在。</b>本地 SQLite 快照，最近 5 个零延迟切换。</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/hub-examples.png')" alt="内置示例库 — 15 个即可运行的设计命题" />
    <figcaption><b>15 个 demo brief。</b>落地页、仪表盘、定价、聊天 UI 一键体验。</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/add-provider-menu.png')" alt="添加 provider 菜单——Claude Code、Codex、自定义、预设" />
    <figcaption><b>自带模型。</b>导入 Claude Code / Codex 配置，或任何 OpenAI 兼容 provider。</figcaption>
  </figure>
</div>

</div>

<div class="codesign-section">

## 一份 design 从无到有

<p class="lede">从空白 prompt 到完整 artifact——agent 规划、写代码、自检，最后交回一个 hover / tab / 空状态都已接好的交互式设计。</p>

<div class="codesign-demo-video">
  <DemoVideo src="/demos/generate-from-scratch.mp4" label="从零生成一个 design" />
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
