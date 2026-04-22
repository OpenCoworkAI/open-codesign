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
import { ptBRExamples } from './locales/pt-BR';
import { zhCNExamples } from './locales/zh-CN';
import {
  thumbAiHero,
  thumbAuth,
  thumbBlog,
  thumbCalendar,
  thumbCaseStudy,
  thumbChat,
  thumbCosmic,
  thumbDashboard,
  thumbEmail,
  thumbKanban,
  thumbLanding,
  thumbMobile,
  thumbOrganic,
  thumbPitchSlide,
  thumbPortfolio,
  thumbPricing,
  thumbReceipt,
  thumbSettings,
  thumbStatsCounter,
  thumbTimeline,
  thumbWeather,
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
  {
    id: 'pricing-page',
    category: 'marketing',
    thumbnail: thumbPricing,
    prompt:
      'Design a pricing page for a developer platform called Arcjet. Three tiers: Hobby (free), Pro ($29/mo), Enterprise (custom). Each tier in its own card — Pro card is elevated with a "Most popular" badge. Include a feature comparison table below the cards with 10+ rows and checkmarks. Toggle for monthly/annual billing. Dark mode with subtle gradients, monospace numerals, generous vertical spacing.',
  },
  {
    id: 'blog-article',
    category: 'document',
    thumbnail: thumbBlog,
    prompt:
      'Design a long-form blog article page for a design engineering publication called Pixel & Prose. Include: a full-width hero image area (CSS gradient placeholder), article title in large serif, author byline with avatar initials + publish date, a table of contents sidebar, body text with pull quotes, inline code blocks, and a "Related articles" grid at the bottom. Light theme, classic editorial feel, comfortable reading width (~680px).',
  },
  {
    id: 'event-calendar',
    category: 'ui',
    thumbnail: thumbCalendar,
    prompt:
      'Design a monthly calendar view component for a team scheduling app. Show a full month grid with today highlighted, several events rendered as colored pill bars spanning their duration. Include a mini sidebar with upcoming events list, and a header with month navigation arrows + "Today" button. Clean white surface, subtle grid lines, four distinct event category colors. Make the events interactive — clicking shows a detail tooltip.',
  },
  {
    id: 'chat-interface',
    category: 'mobile',
    thumbnail: thumbChat,
    prompt:
      'Design a messaging app screen inside a phone frame. Show a conversation between two people with: text bubbles (blue for sender, gray for receiver), a typing indicator with three animated dots, timestamps between message groups, an image message with rounded corners, a bottom input bar with text field + send button + attachment icon. Include the iOS status bar and a contact header with avatar + name + online status dot.',
  },
  {
    id: 'portfolio-gallery',
    category: 'ui',
    thumbnail: thumbPortfolio,
    prompt:
      'Design a photographer portfolio page with a masonry image grid. Use CSS gradient placeholders in varied aspect ratios (landscape, portrait, square) as image stand-ins. Include: a minimal top nav with the photographer name as a wordmark, category filter pills (All, Portrait, Landscape, Street, Abstract), and a lightbox-style hover overlay on each image showing the title + camera settings. Dark background (#0a0a0a), thin white borders, smooth hover transitions.',
  },
  {
    id: 'receipt-invoice',
    category: 'document',
    thumbnail: thumbReceipt,
    prompt:
      'Design a print-ready invoice/receipt for a design agency called Studio Neon. Include: company logo area, invoice number + date, billing/shipping addresses side by side, an itemized table with 5 line items (description, quantity, rate, amount), subtotal/tax/total breakdown, payment terms, and a "Thank you" footer note. Clean minimal design, cream background, charcoal text, one accent color for totals. Proportioned for A4/Letter print.',
  },
  {
    id: 'settings-panel',
    category: 'ui',
    thumbnail: thumbSettings,
    prompt:
      'Design a settings page for a SaaS application. Left sidebar with setting categories (Profile, Notifications, Security, Billing, Team, Integrations). Main panel shows the active category with form fields: text inputs, toggle switches, dropdown selects, a danger zone with red "Delete account" button. Include a top bar with breadcrumbs and a "Save changes" button. Light theme, clean form layout, proper spacing between sections, accessible focus states on all inputs.',
  },
  {
    id: 'auth-signin',
    category: 'ui',
    thumbnail: thumbAuth,
    prompt:
      'Design a sign-in screen for a SaaS product called Lumen. A centered card on a dark starry background holds: product wordmark, "Welcome back" headline, email + password inputs, a primary sign-in button in brand indigo, "Forgot password?" link on the right, an OR divider, three social sign-in buttons (Google / GitHub / Apple) with brand glyphs, and a "Don\'t have an account? Sign up" footer link. Rounded inputs, clear focus rings, subtle card elevation.',
  },
  {
    id: 'kanban-board',
    category: 'ui',
    thumbnail: thumbKanban,
    prompt:
      'Design a kanban board for a product team. Three columns: Backlog, In progress, Done — each with a colored header bar (amber / blue / green) and a count pill. Each column holds 3-5 task cards showing title, a short description, an avatar stack of assignees, and a priority tag. Top bar has the project name, a board/list view toggle, filter chips, and an "Add task" button on the right. Soft gray canvas, white cards, rounded corners, lift-on-hover shadow.',
  },
  {
    id: 'ai-product-hero',
    category: 'marketing',
    thumbnail: thumbAiHero,
    prompt:
      'Design a hero section for an AI writing assistant called Inkwell. Deep navy → violet gradient background with a soft glowing orb on the right surrounded by concentric rings. Large serif-meets-sans headline, a two-line subhead, an animated caret cursor after the headline (steady blink), and a pair of CTAs (primary gradient button, ghost secondary). Sparse star field, subtle grain overlay, confident editorial feel.',
  },
  {
    id: 'weather-card',
    category: 'mobile',
    thumbnail: thumbWeather,
    prompt:
      'Design a mobile weather home screen inside a phone frame. Soft sky-blue → indigo gradient background, a large glass-morphism card in the center showing: city name, current temperature in thin 72px weight, condition glyph (sun behind clouds), high/low, and a horizontal 6-hour forecast strip with small icons + temperatures. Below the card, a second smaller card with "Next 7 days" summary bars. Rounded corners everywhere, gentle translucency, generous padding.',
  },
  {
    id: 'timeline-changelog',
    category: 'document',
    thumbnail: thumbTimeline,
    prompt:
      'Design a product changelog page presented as a vertical timeline. Left spine connects four release dots in different accent colors. Each entry has: a date label, a version tag, a headline, a 2-3 line description, and optional inline mini-tags (feature / fix / breaking). Above the timeline sits a filter row (All / Features / Fixes / Breaking) and a subscribe-to-RSS pill. Warm off-white background, serif headings, restrained typography.',
  },
  {
    id: 'stats-counter',
    category: 'animation',
    thumbnail: thumbStatsCounter,
    prompt:
      'Design a stats strip section for a landing page with three large animated number counters that count up from 0 to their target on scroll into view (2.4M users, 99.8% uptime, 180 countries). Each stat sits in a translucent card on a deep navy background, with its own neon accent color (sky / violet / green) glowing behind the number. Small all-caps label below each number, tight letter-spacing. Counters ease-out over ~1.2s, no JS libraries — pure IntersectionObserver + requestAnimationFrame.',
  },
];

const REGISTRY: Record<Locale, Record<string, ExampleContent>> = {
  en: enExamples,
  'zh-CN': zhCNExamples,
  'pt-BR': ptBRExamples,
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
