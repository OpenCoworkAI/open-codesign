import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitepress';
import rootPkg from '../../package.json' with { type: 'json' };

const SITE_ORIGIN = 'https://opencoworkai.github.io';
const SITE_BASE = '/open-codesign/';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const OG_IMAGE = `${SITE_URL}og.svg`;
const SOFTWARE_VERSION = (rootPkg as { version: string }).version;

export default defineConfig({
  title: 'Open CoDesign',
  titleTemplate: ':title — Open CoDesign',
  description:
    'Open-source desktop AI design tool — the self-hosted alternative to Claude Design. Multi-model BYOK (Anthropic, OpenAI, Gemini, DeepSeek, Ollama), local-first, MIT.',
  lang: 'en-US',

  base: SITE_BASE,
  cleanUrls: true,
  lastUpdated: true,

  vite: {
    plugins: [tailwindcss()],
  },

  head: [
    ['link', { rel: 'icon', type: 'image/x-icon', href: `${SITE_BASE}favicon.ico` }],
    [
      'link',
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${SITE_BASE}favicon-32x32.png` },
    ],
    [
      'link',
      { rel: 'icon', type: 'image/png', sizes: '16x16', href: `${SITE_BASE}favicon-16x16.png` },
    ],
    [
      'link',
      { rel: 'apple-touch-icon', sizes: '180x180', href: `${SITE_BASE}apple-touch-icon.png` },
    ],
    ['meta', { name: 'theme-color', content: '#c96442' }],
    ['meta', { name: 'google-site-verification', content: 'c3cbbeaec5437546' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Open CoDesign' }],
    ['meta', { property: 'og:title', content: 'Open CoDesign — Open-Source AI Design Tool' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Open-source desktop AI design tool. A self-hosted alternative to Claude Design. Prompt to prototype, slide deck, or marketing asset. Multi-model BYOK, local-first, MIT.',
      },
    ],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    // Twitter / X
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:site', content: '@OpenCoworkAI' }],
    ['meta', { name: 'twitter:title', content: 'Open CoDesign — Open-Source AI Design Tool' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content: 'Open-source desktop AI design tool. BYOK, local-first, MIT. Runs on your laptop.',
      },
    ],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    // SEO keywords — natural density, not stuffed
    [
      'meta',
      {
        name: 'keywords',
        content:
          'open source AI design tool, Claude Design alternative, BYOK design app, local-first design generator, AI prototype generator, prompt to HTML, prompt to React component, open-codesign, multi-model design, Electron design app',
      },
    ],
    ['meta', { name: 'robots', content: 'index,follow,max-image-preview:large' }],
    ['meta', { name: 'author', content: 'OpenCoworkAI' }],
    ['link', { rel: 'alternate', hreflang: 'en', href: SITE_URL }],
    ['link', { rel: 'alternate', hreflang: 'zh-CN', href: `${SITE_URL}zh/` }],
    ['link', { rel: 'alternate', hreflang: 'x-default', href: SITE_URL }],
    // JSON-LD — SoftwareApplication
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Open CoDesign',
        alternateName: 'open-codesign',
        description:
          'Open-source desktop AI design tool. The open-source alternative to Anthropic Claude Design. Prompt to interactive prototype, slide deck, and marketing assets. Multi-model BYOK, local-first.',
        url: SITE_URL,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'macOS, Windows, Linux',
        softwareVersion: SOFTWARE_VERSION,
        releaseNotes: `${SITE_URL}#whats-working-today`,
        downloadUrl: 'https://github.com/OpenCoworkAI/open-codesign/releases',
        screenshot: [
          `${SITE_ORIGIN}/open-codesign/screenshots/product-hero.png`,
          `${SITE_ORIGIN}/open-codesign/screenshots/comment-mode.png`,
        ],
        applicationSubCategory: 'AI Design Tool',
        featureList: [
          'Prompt-to-HTML prototype generation',
          'Bring your own API key (Anthropic, OpenAI, Gemini, DeepSeek, Ollama, OpenRouter)',
          'Local-first storage (SQLite + TOML)',
          'Export to PDF, PPTX, ZIP, Markdown',
          'Multi-model switching without re-login',
          'One-click import of Claude Code / Codex API keys',
          'AI image generation for design assets',
          'Design history with snapshots and rollback',
        ],
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          description: 'Free and open source. Bring your own API key (token cost only).',
        },
        license: 'https://opensource.org/licenses/MIT',
        codeRepository: 'https://github.com/OpenCoworkAI/open-codesign',
        author: {
          '@type': 'Organization',
          name: 'OpenCoworkAI',
          url: 'https://github.com/OpenCoworkAI',
        },
        keywords:
          'Claude Design alternative, open source AI design, BYOK, local-first, Anthropic, Electron desktop app, prompt to prototype, React component generator, AI design tool',
      }),
    ],
    // JSON-LD — FAQPage (helps AI answers and Google rich results)
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is Open CoDesign?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Open CoDesign is an open-source desktop AI design tool that turns natural-language prompts into HTML prototypes, JSX/React components, slide decks, and marketing assets. It is the open-source alternative to Anthropic Claude Design and runs entirely on your laptop.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is Open CoDesign free?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. Open CoDesign is MIT licensed and free to download and use. You bring your own API key for any supported model provider and pay only the token cost to that provider. There is no subscription, no cloud account, and no per-token surcharge from us.',
            },
          },
          {
            '@type': 'Question',
            name: 'Which AI models can I use with Open CoDesign?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, and any OpenAI-compatible endpoint. Keyless (IP-allowlisted) corporate proxies are also supported.',
            },
          },
          {
            '@type': 'Question',
            name: 'Does Open CoDesign send my data to the cloud?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No. All designs, prompts, and configuration live on your machine — SQLite for history and encrypted TOML (via Electron safeStorage) for configuration. The only outbound network traffic is to the model provider you configure.',
            },
          },
          {
            '@type': 'Question',
            name: 'How is Open CoDesign different from Claude Design?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Open CoDesign is open source, runs locally, supports any AI model via BYOK, ships twelve built-in design skill modules and fifteen demo prompts, imports your existing Claude Code or Codex config in one click, and exports to HTML, PDF, PPTX, ZIP, and Markdown. Claude Design is closed source, cloud-only, Anthropic-only, subscription-priced, and has limited export.',
            },
          },
          {
            '@type': 'Question',
            name: 'Which platforms are supported?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'macOS (Apple Silicon and Intel), Windows (x64 and arm64), and Linux (AppImage, .deb, .rpm). Heavy features like PDF and PPTX export are lazy-loaded.',
            },
          },
        ],
      }),
    ],
    // JSON-LD — Organization
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'OpenCoworkAI',
        url: 'https://github.com/OpenCoworkAI',
        logo: `${SITE_URL}logo.png`,
        sameAs: ['https://github.com/OpenCoworkAI', 'https://twitter.com/OpenCoworkAI'],
      }),
    ],
  ],

  sitemap: { hostname: SITE_URL },

  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '');
    const canonical = `${SITE_URL}${path}`;
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(['link', { rel: 'canonical', href: canonical }]);
  },

  themeConfig: {
    logo: { src: '/logo.png', alt: 'open-codesign' },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Features', link: '/#features' },
      { text: 'Quickstart', link: '/quickstart' },
      {
        text: 'Compare',
        items: [
          { text: 'vs Claude Design', link: '/claude-design-alternative' },
          { text: 'vs v0 by Vercel', link: '/v0-alternative' },
          { text: 'vs Lovable', link: '/lovable-alternative' },
          { text: 'vs Bolt.new', link: '/bolt-alternative' },
          { text: 'vs Figma AI', link: '/figma-ai-alternative' },
        ],
      },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'FAQ', link: '/faq' },
      {
        text: 'Changelog',
        link: 'https://github.com/OpenCoworkAI/open-codesign/blob/main/CHANGELOG.md',
      },
    ],

    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Quickstart', link: '/quickstart' },
        ],
      },
      {
        text: 'Compare',
        items: [
          { text: 'vs Claude Design', link: '/claude-design-alternative' },
          { text: 'vs v0 by Vercel', link: '/v0-alternative' },
          { text: 'vs Lovable', link: '/lovable-alternative' },
          { text: 'vs Bolt.new', link: '/bolt-alternative' },
          { text: 'vs Figma AI', link: '/figma-ai-alternative' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Roadmap', link: '/roadmap' },
          {
            text: 'Changelog',
            link: 'https://github.com/OpenCoworkAI/open-codesign/blob/main/CHANGELOG.md',
          },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/OpenCoworkAI/open-codesign' }],

    footer: {
      message:
        'Released under the <a href="https://opensource.org/licenses/MIT">MIT License</a>. · <a href="https://github.com/OpenCoworkAI/open-codesign/blob/main/CONTRIBUTING.md">Contribute</a> · <a href="https://github.com/OpenCoworkAI/open-codesign/issues">Issues</a>',
      copyright: '© 2026-present OpenCoworkAI',
    },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      title: 'Open CoDesign',
      description:
        '开源桌面 AI 设计工具——Claude Design 的自托管替代方案。自带 API Key（Anthropic、OpenAI、Gemini、DeepSeek、Ollama），100% 本地运行，MIT。',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '快速开始', link: '/zh/quickstart' },
          { text: '对比 Claude Design', link: '/zh/claude-design-alternative' },
          { text: '常见问题', link: '/zh/faq' },
          { text: 'GitHub', link: 'https://github.com/OpenCoworkAI/open-codesign' },
        ],
        sidebar: [
          {
            text: '入门',
            items: [
              { text: '简介', link: '/zh/' },
              { text: '快速开始', link: '/zh/quickstart' },
              { text: '对比 Claude Design', link: '/zh/claude-design-alternative' },
              { text: '常见问题', link: '/zh/faq' },
            ],
          },
        ],
        footer: {
          message: '基于 MIT 协议开源。',
          copyright: '© 2026-present OpenCoworkAI',
        },
      },
    },
  },
});
