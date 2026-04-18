import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitepress';

const SITE_ORIGIN = 'https://opencoworkai.github.io';
const SITE_BASE = '/open-codesign/';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const OG_IMAGE = `${SITE_URL}og.svg`;

export default defineConfig({
  title: 'Open CoDesign',
  titleTemplate: ':title — Open CoDesign',
  description:
    'Open-source desktop AI design tool — the Claude Design alternative you can self-host. Multi-model BYOK (Anthropic, OpenAI, Gemini, Ollama), local-first, Apache-2.0.',
  lang: 'en-US',

  base: SITE_BASE,
  cleanUrls: true,
  lastUpdated: true,

  vite: {
    plugins: [tailwindcss()],
  },

  head: [
    ['link', { rel: 'icon', href: `${SITE_BASE}favicon.ico` }],
    ['meta', { name: 'theme-color', content: '#c96442' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Open CoDesign' }],
    ['meta', { property: 'og:title', content: 'Open CoDesign — Open-Source AI Design Tool' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'The open-source alternative to Claude Design. Prompt to prototype, slide deck, or marketing asset. Multi-model BYOK, local-first, Apache-2.0.',
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
        content:
          'The open-source alternative to Anthropic Claude Design. BYOK, local-first, Apache-2.0. Runs on your laptop.',
      },
    ],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    // SEO keywords — natural density, not stuffed
    [
      'meta',
      {
        name: 'keywords',
        content:
          'Claude Design alternative, open source AI design tool, BYOK design app, local-first design generator, Anthropic Claude Design open source, AI prototype generator, open-codesign, multi-model design, BYOK Electron app',
      },
    ],
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
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          description: 'Free and open source. Bring your own API key (token cost only).',
        },
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        codeRepository: 'https://github.com/OpenCoworkAI/open-codesign',
        author: {
          '@type': 'Organization',
          name: 'OpenCoworkAI',
          url: 'https://github.com/OpenCoworkAI',
        },
        keywords:
          'Claude Design alternative, open source AI design, BYOK, local-first, Anthropic, Electron desktop app',
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
    logo: { src: '/favicon.ico', alt: 'open-codesign' },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Why', link: '/#how-it-compares' },
      { text: 'Features', link: '/#features' },
      { text: 'Quickstart', link: '/quickstart' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Pricing', link: '/quickstart#add-your-api-key' },
      { text: 'GitHub', link: 'https://github.com/OpenCoworkAI/open-codesign' },
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
        text: 'Project',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/OpenCoworkAI/open-codesign' },
      { icon: 'twitter', link: 'https://twitter.com/OpenCoworkAI' },
    ],

    footer: {
      message:
        'Released under the <a href="https://www.apache.org/licenses/LICENSE-2.0">Apache-2.0 License</a>. · <a href="https://github.com/OpenCoworkAI/open-codesign/blob/main/CONTRIBUTING.md">Contribute</a> · <a href="https://github.com/OpenCoworkAI/open-codesign/issues">Issues</a>',
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
      title: 'open-codesign',
      description:
        '开源桌面 AI 设计工具——一句话生成交互原型、幻灯片与营销素材。多模型、自带密钥、本地优先。',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '快速开始', link: '/zh/quickstart' },
          { text: 'GitHub', link: 'https://github.com/OpenCoworkAI/open-codesign' },
        ],
        sidebar: [
          {
            text: '入门',
            items: [
              { text: '简介', link: '/zh/' },
              { text: '快速开始', link: '/zh/quickstart' },
            ],
          },
        ],
        footer: {
          message: '基于 Apache-2.0 协议开源。',
          copyright: '© 2026-present OpenCoworkAI',
        },
      },
    },
  },
});
