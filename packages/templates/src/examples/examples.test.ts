import { describe, expect, it } from 'vitest';
import { DEMO_INPUTS } from '../demo-inputs';
import { EXAMPLE_FEATURES, EXAMPLES, getExample, getExamples } from './index';
import { enExamples } from './locales/en';
import { zhCNExamples } from './locales/zh-CN';

describe('examples gallery', () => {
  it('ships the expanded curated example library', () => {
    expect(EXAMPLES.length).toBe(87);
  });

  it('every example has a unique id', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('features three input packs first without changing existing IDs', () => {
    expect(EXAMPLES.slice(0, 3).map((example) => example.id)).toEqual(Object.keys(DEMO_INPUTS));
    expect(getExample('cosmic-animation')?.inputBundle).toBeUndefined();
    for (const locale of ['en', 'zh-CN', 'es', 'pt-BR']) {
      for (const example of getExamples(locale).slice(0, 3)) {
        expect(example.inputBundle).toBeDefined();
        if (!example.inputBundle) throw new Error('Expected bundle');
        expect(example.inputFiles).toEqual(DEMO_INPUTS[example.inputBundle].files);
        expect(example.features?.every((feature) => EXAMPLE_FEATURES.includes(feature))).toBe(true);
        expect(new Set(example.features).size).toBe(example.features?.length);
        expect(example.title).toBeTruthy();
        for (const file of example.inputFiles ?? []) expect(example.prompt).toContain(file);
      }
    }
  });

  it('covers scaffold, skill, and brand-reference stress scenarios', () => {
    const ids = new Set(EXAMPLES.map((e) => e.id));
    for (const id of [
      'watch-run-coach',
      'foldable-travel-planner',
      'vision-pro-spatial-gallery',
      'safari-product-tour',
      'terminal-release-monitor',
      'vscode-extension-marketplace',
      'drawer-inspector',
      'toast-notification-center',
      'skeleton-loading-dashboard',
      'empty-state-library',
      'cjk-editorial-longform',
      'stripe-brand-checkout',
      'linear-roadmap',
      'raycast-launcher',
    ]) {
      expect(ids.has(id), `missing coverage scenario: ${id}`).toBe(true);
    }
  });

  it('every example has a non-trivial prompt and inline SVG thumbnail', () => {
    for (const ex of EXAMPLES) {
      expect(ex.prompt.length).toBeGreaterThan(40);
      expect(ex.thumbnail).toMatch(/^<svg /);
    }
  });

  it('every example has en + zh-CN title/description coverage', () => {
    for (const ex of EXAMPLES) {
      const en = enExamples[ex.id];
      const zh = zhCNExamples[ex.id];
      expect(en, `missing en content for ${ex.id}`).toBeDefined();
      expect(zh, `missing zh-CN content for ${ex.id}`).toBeDefined();
      expect(en?.title.length).toBeGreaterThan(0);
      expect(en?.description.length).toBeGreaterThan(0);
      expect(zh?.title.length).toBeGreaterThan(0);
      expect(zh?.description.length).toBeGreaterThan(0);
    }
  });

  it('every zh-CN example has a localized prompt override', () => {
    for (const ex of EXAMPLES) {
      const zh = zhCNExamples[ex.id];
      expect(zh?.prompt, `missing zh-CN prompt for ${ex.id}`).toBeDefined();
      expect(zh?.prompt?.length).toBeGreaterThan(40);
      expect(zh?.prompt).not.toBe(ex.prompt);
    }
  });

  it('getExamples returns localized content', () => {
    const en = getExamples('en');
    const zh = getExamples('zh-CN');
    expect(en).toHaveLength(EXAMPLES.length);
    expect(zh).toHaveLength(EXAMPLES.length);
    const cosmicEn = en.find((e) => e.id === 'cosmic-animation');
    const cosmicZh = zh.find((e) => e.id === 'cosmic-animation');
    expect(cosmicEn?.title).toBe('Cosmic scale animation');
    expect(cosmicZh?.title).toBe('宇宙尺度动画');
    expect(cosmicEn?.prompt).toContain('Outer Frame');
    expect(cosmicZh?.prompt).toContain('航天科技公司');
    expect(cosmicZh?.prompt).not.toBe(cosmicEn?.prompt);
  });

  it('locales without prompt coverage fall back to the English source prompt', () => {
    const es = getExamples('es');
    const launchEs = es.find((e) => e.id === 'product-launch-page');
    const launchEn = getExample('product-launch-page', 'en');
    expect(launchEs?.title).toBe(launchEn?.title);
    expect(launchEs?.prompt).toBe(launchEn?.prompt);
  });

  it('getExamples falls back to en for unknown locales', () => {
    const fallback = getExamples('fr-FR');
    expect(fallback[0]?.title).toBe(getExamples('en')[0]?.title);
  });

  it('getExample looks up by id', () => {
    const ex = getExample('dashboard', 'en');
    expect(ex?.category).toBe('dashboard');
    expect(getExample('does-not-exist')).toBeUndefined();
  });

  it('getExamples throws when a locale entry is missing in every registry', () => {
    const id = EXAMPLES[0]?.id ?? 'cosmic-animation';
    const enBackup = enExamples[id];
    const zhBackup = zhCNExamples[id];
    delete enExamples[id];
    delete zhCNExamples[id];
    try {
      expect(() => getExamples('zh-CN')).toThrow(/missing localized content/);
    } finally {
      if (enBackup) enExamples[id] = enBackup;
      if (zhBackup) zhCNExamples[id] = zhBackup;
    }
  });
});
