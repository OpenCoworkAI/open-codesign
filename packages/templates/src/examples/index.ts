/**
 * Built-in examples surfaced in the hub's Examples gallery.
 *
 * Examples differ from `DemoTemplate` in two ways:
 *   1. They carry a `category` so the gallery can group/filter without a
 *      separate taxonomy file.
 *   2. They carry a `thumbnail` SVG markup string used as the hover preview
 *      until we ship real video previews.
 *
 * Title/description live per-locale; the prompt is the canonical English
 * source (the model is multilingual either way).
 */

import { type Locale, availableLocales, normalizeLocale } from '@open-codesign/i18n';
import { enExamples } from './locales/en';
import { zhCNExamples } from './locales/zh-CN';
import {
  thumbCaseStudy,
  thumbCosmic,
  thumbDashboard,
  thumbEmail,
  thumbLanding,
  thumbMobile,
  thumbOrganic,
  thumbPitchSlide,
} from './thumbnails';

export type ExampleCategory =
  | 'animation'
  | 'ui'
  | 'marketing'
  | 'document'
  | 'dashboard'
  | 'presentation'
  | 'email'
  | 'mobile';

export interface ExampleContent {
  title: string;
  description: string;
}

export interface Example {
  id: string;
  category: ExampleCategory;
  prompt: string;
  thumbnail: string;
}

export interface LocalizedExample extends Example, ExampleContent {}

export const EXAMPLES: Example[] = [
  {
    id: 'cosmic-animation',
    category: 'animation',
    thumbnail: thumbCosmic,
    prompt:
      'Build a single-page hero section for a space-tech company called Outer Frame. Center an animated cosmic scene: a glowing sun, three orbiting rings with subtle parallax, and a sparse star field. Use deep navy → black background, warm sun gradient (amber → coral), one short tagline above the scene, and a single ghost CTA below. Smooth 60fps CSS animations only — no JS libraries.',
  },
  {
    id: 'organic-loaders',
    category: 'ui',
    thumbnail: thumbOrganic,
    prompt:
      'Design a small showcase page presenting six organic loading indicators. Each loader sits in its own card with a label and a one-line description. Loaders should feel hand-drawn: blob morphs, leaf sway, ink drop, breathing circle, soft pulse, ribbon weave. Use a warm cream background and muted pastels. Pure CSS / SVG animations.',
  },
  {
    id: 'landing-page',
    category: 'marketing',
    thumbnail: thumbLanding,
    prompt:
      'Design a marketing landing page for a productivity tool called Field Notes. Include a hero with headline + sub-headline + primary CTA, a feature grid of three benefits, a testimonial strip, a pricing teaser, and a footer. Editorial typography, generous whitespace, off-white background, charcoal text, one accent color (deep ochre).',
  },
  {
    id: 'case-study',
    category: 'document',
    thumbnail: thumbCaseStudy,
    prompt:
      "Create a one-page customer case study for a B2B fintech. Layout: tall hero with client name + tagline, a row of three large metrics (each with delta + label), a pull quote from the CFO, a 'How we did it' three-step section, and a small logo strip. Dark theme, serif headings, monospace numerals, print-ready 8.5×11 proportions.",
  },
  {
    id: 'dashboard',
    category: 'dashboard',
    thumbnail: thumbDashboard,
    prompt:
      'Design an analytics dashboard for a SaaS revenue team. Left rail with five nav items, top header with date range + filters, then a 2×2 grid of cards: MRR trend (line chart), pipeline by stage (stacked bars), top accounts (table), and forecast attainment (radial gauge). Dark UI, neutral surfaces, two accent colors (teal + amber). Use plausible mock data.',
  },
  {
    id: 'pitch-slide',
    category: 'presentation',
    thumbnail: thumbPitchSlide,
    prompt:
      "Design a single 16:9 pitch slide titled 'Why now'. Layout: small section eyebrow ('Market timing'), a strong one-line statement, three short supporting bullets stacked left, a simple two-line trend chart on the right, and a footer with the company logo + slide number. Off-white background, navy text, one orange accent. Confident, restrained typography.",
  },
  {
    id: 'email',
    category: 'email',
    thumbnail: thumbEmail,
    prompt:
      'Design a transactional welcome email for a design tool called Studio Loop. Single column, 600px wide, table-based for client compatibility. Header band with logo on a deep indigo background, then a friendly greeting, three short steps to get started (each with a small icon glyph and one-line description), a primary CTA button, and a minimal footer with unsubscribe + address. Light surface, indigo accents, system font stack.',
  },
  {
    id: 'mobile-app',
    category: 'mobile',
    thumbnail: thumbMobile,
    prompt:
      "Design a single mobile app screen inside a phone frame: the home screen of a habit tracker called Streak. Show today's date at the top, a hero card for the current streak count, a list of four habits each with a circular progress ring + check button, and a bottom tab bar with five icons. Soft mint background, white cards, charcoal text, generous touch targets.",
  },
];

const REGISTRY: Record<Locale, Record<string, ExampleContent>> = {
  en: enExamples,
  'zh-CN': zhCNExamples,
};

function getRegistry(locale: string | undefined): Record<string, ExampleContent> {
  const target = normalizeLocale(locale);
  const reg = REGISTRY[target];
  if (!reg) {
    console.warn(
      `[templates/examples] no examples registered for locale "${target}"; falling back to "en". ` +
        `Supported: ${availableLocales.join(', ')}`,
    );
    return enExamples;
  }
  return reg;
}

export function getExamples(locale?: string): LocalizedExample[] {
  const target = normalizeLocale(locale);
  const reg = getRegistry(locale);
  return EXAMPLES.map((ex) => {
    const content = reg[ex.id] ?? enExamples[ex.id];
    if (!content) {
      throw new Error(
        `[templates/examples] missing localized content for example id "${ex.id}" (locale: "${target}")`,
      );
    }
    return { ...ex, ...content };
  });
}

export function getExample(id: string, locale?: string): LocalizedExample | undefined {
  return getExamples(locale).find((e) => e.id === id);
}
