import { defineConfig } from 'vitepress';
import tailwindcss from '@tailwindcss/vite';

const SITE_ORIGIN = 'https://opencoworkai.github.io';
const SITE_BASE = '/open-codesign/';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const OG_IMAGE = `${SITE_URL}og.svg`;

export default defineConfig({
  title: 'open-codesign',
  description:
    'Open-source desktop AI design tool — prompt to interactive prototype, slide deck, and marketing assets. Multi-model, BYOK, runs on your laptop.',

  base: SITE_BASE,
  cleanUrls: true,
  lastUpdated: true,

  vite: {
    plugins: [tailwindcss()],
  },

  head: [
    ['link', { rel: 'icon', href: `${SITE_BASE}favicon.ico` }],
    ['meta', { name: 'theme-color', content: '#c96442' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'open-codesign — Open-Source AI Design Tool' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Prompt to interactive prototype, slide deck, and marketing assets. Multi-model, BYOK, local-first. Apache-2.0.',
      },
    ],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'open-codesign — Open-Source AI Design Tool' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Open-source desktop AI design tool. Multi-model, BYOK, local-first. Apache-2.0.',
      },
    ],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'open-codesign, AI design, Claude Design alternative, open source, multi-model, BYOK, local-first, desktop app, prototype generator, PPTX, design tokens',
      },
    ],
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'open-codesign',
        description:
          'Open-source desktop AI design tool — prompt to interactive prototype, slide deck, and marketing assets.',
        url: SITE_URL,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'macOS, Windows',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        author: {
          '@type': 'Organization',
          name: 'OpenCoworkAI',
          url: 'https://github.com/OpenCoworkAI',
        },
      }),
    ],
  ],

  sitemap: { hostname: SITE_URL },

  themeConfig: {
    logo: { src: '/favicon.ico', alt: 'open-codesign' },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Quickstart', link: '/quickstart' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Roadmap', link: '/roadmap' },
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
    ],

    footer: {
      message: 'Released under the Apache-2.0 License.',
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
