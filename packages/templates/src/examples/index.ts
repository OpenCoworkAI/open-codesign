/**
 * Built-in examples surfaced in the hub's Examples gallery.
 *
 * Examples differ from `DemoTemplate` in two ways:
 *   1. They carry a `category` so the gallery can group/filter without a
 *      separate taxonomy file.
 *   2. They carry a `thumbnail` SVG markup string used as the hover preview
 *      until we ship real video previews.
 *
 * Title/description live per-locale. The base prompt is the default English
 * source; locales may override it when users should see a prompt in their
 * interface language.
 */

import { availableLocales, type Locale, normalizeLocale } from '@open-codesign/i18n';
import type { DemoInputId } from '../demo-inputs';
import { demoPackExamples } from './demo-packs';
import { enExamples } from './locales/en';
import { esExamples } from './locales/es';
import { ptBRExamples } from './locales/pt-BR';
import { zhCNExamples } from './locales/zh-CN';
import {
  thumbAgencyHomepage,
  thumbAgendaPlanner,
  thumbAiHero,
  thumbAndroidWalletScreen,
  thumbAnnualReport,
  thumbArcResearchBrowser,
  thumbAuth,
  thumbBilingualEventPage,
  thumbBlog,
  thumbBoardUpdateDeck,
  thumbCalcomBookingFlow,
  thumbCalendar,
  thumbCaseStudy,
  thumbChat,
  thumbCheckoutFlow,
  thumbCjkEditorialLongform,
  thumbCommandCenter,
  thumbCosmic,
  thumbCreatorAnalyticsDashboard,
  thumbCustomerSupportDashboard,
  thumbDashboard,
  thumbDesignTokenInspector,
  thumbDigestNewsletter,
  thumbDrawerInspector,
  thumbEcommerceInventoryDashboard,
  thumbEducationAnalyticsDashboard,
  thumbEmail,
  thumbEmptyStateLibrary,
  thumbEnterpriseSecurityPage,
  thumbFileManager,
  thumbFileTreeCodeReview,
  thumbFinanceOpsDashboard,
  thumbFitnessWorkoutBuilder,
  thumbFoldableTravelPlanner,
  thumbFoodDeliveryTracker,
  thumbHealthcareAppointmentsDashboard,
  thumbIbmEnterpriseReport,
  thumbIpadMagazineReader,
  thumbKanban,
  thumbKineticPoster,
  thumbLanding,
  thumbLinearRoadmap,
  thumbMobile,
  thumbMobileBankingApp,
  thumbNonprofitCampaignPage,
  thumbNotionKnowledgeBase,
  thumbObservabilityDashboard,
  thumbOnboardingWizard,
  thumbOpenSourceProjectPage,
  thumbOrganic,
  thumbParticleField,
  thumbPaymentReminderEmail,
  thumbPitchSlide,
  thumbPortfolio,
  thumbPressKit,
  thumbPricing,
  thumbProductBrief,
  thumbProductLaunchPage,
  thumbProductRoadmapDeck,
  thumbProductUpdateEmail,
  thumbProgressMicrointeractions,
  thumbRaycastLauncher,
  thumbReceipt,
  thumbResearchReadoutDeck,
  thumbResearchSummary,
  thumbResumeCv,
  thumbSafariProductTour,
  thumbSalesProposalDeck,
  thumbSettings,
  thumbShopifyMerchantDashboard,
  thumbSkeletonLoadingDashboard,
  thumbSpotifyCampaignPage,
  thumbStatsCounter,
  thumbStripeBrandCheckout,
  thumbTerminalReleaseMonitor,
  thumbTimeline,
  thumbToastNotificationCenter,
  thumbVisionProSpatialGallery,
  thumbVscodeExtensionMarketplace,
  thumbWaitlistPage,
  thumbWatchRunCoach,
  thumbWeather,
  thumbWebinarRegistration,
  thumbWorkshopDeck,
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
  prompt?: string;
}

export interface Example {
  id: string;
  category: ExampleCategory;
  prompt: string;
  thumbnail: string;
  features?: readonly ExampleFeature[];
  inputBundle?: DemoInputId;
  inputFiles?: readonly string[];
}

export const EXAMPLE_FEATURES = [
  'local-assets',
  'document-input',
  'sketch-reference',
  'multi-screen',
  'shared-state',
  'interactive-flow',
  'responsive',
] as const;

export type ExampleFeature = (typeof EXAMPLE_FEATURES)[number];

export interface LocalizedExample extends Example {
  title: string;
  description: string;
}

export const EXAMPLES: Example[] = [
  ...demoPackExamples,
  {
    id: 'cosmic-animation',
    category: 'animation',
    thumbnail: thumbCosmic,
    prompt:
      'Build a single-page hero section for a space-tech company called Outer Frame, aimed at aerospace buyers and technical founders. Center an animated cosmic scene with a glowing sun, three orbiting rings with subtle parallax, sparse stars, and a mission-control caption rail. Include one short tagline above the scene, a compact credibility strip, and a ghost CTA below. Keep it responsive from mobile to desktop, use smooth 60fps CSS/SVG animations only, and avoid external stock or placeholder images.',
  },
  {
    id: 'organic-loaders',
    category: 'ui',
    thumbnail: thumbOrganic,
    prompt:
      'Design a polished component showcase page presenting six organic loading indicators for a wellness product UI kit. Each loader should sit in a labeled card with a one-line usage note, paused/active visual state, and accessible loading text. Include blob morph, leaf sway, ink drop, breathing circle, soft pulse, and ribbon weave. Use warm cream, muted pastels, generous spacing, pure CSS/SVG animation, responsive wrapping, and no external image assets.',
  },
  {
    id: 'landing-page',
    category: 'marketing',
    thumbnail: thumbLanding,
    prompt:
      'Design a marketing landing page for a productivity tool called Field Notes, aimed at small product teams. Include a first-viewport hero with headline, subhead, product UI hint, primary CTA, and secondary link; then three benefit sections, a concise testimonial strip, a pricing teaser, and a footer. Use editorial typography, generous whitespace, off-white surfaces, charcoal text, and a deep ochre accent. Make all copy domain-specific and responsive, with no hotlinked stock or placeholder images.',
  },
  {
    id: 'case-study',
    category: 'document',
    thumbnail: thumbCaseStudy,
    prompt:
      "Create a print-ready one-page customer case study for a B2B fintech, proportioned for 8.5x11 and readable as a web preview. Layout: tall hero with client name and business context, three before/after metrics with deltas, a CFO pull quote, a 'How we did it' three-step section, a compact architecture/process diagram, and a small logo strip. Use dark theme, serif headings, monospace numerals, concrete mock data, and no lorem ipsum or external images.",
  },
  {
    id: 'dashboard',
    category: 'dashboard',
    thumbnail: thumbDashboard,
    prompt:
      'Design an analytics dashboard for a SaaS revenue team. Include a left rail with five nav items, a top header with date range and segment filters, and a 2x2 grid: MRR trend line chart, pipeline by stage stacked bars, top accounts table, and forecast attainment gauge. Add empty/filter states for at least one card and plausible mock data with realistic labels. Use a dense dark UI, neutral surfaces, teal and amber accents, keyboard-visible controls, and responsive behavior for narrower widths.',
  },
  {
    id: 'pitch-slide',
    category: 'presentation',
    thumbnail: thumbPitchSlide,
    prompt:
      "Design a single 16:9 pitch slide titled 'Why now' for an infrastructure startup. Include a small eyebrow ('Market timing'), one strong thesis sentence, three concise support bullets on the left, a two-line trend chart on the right, and a footer with company mark, source note, and slide number. Use off-white background, navy text, one orange accent, restrained typography, real-looking numbers, and fixed slide-safe spacing that will export cleanly.",
  },
  {
    id: 'email',
    category: 'email',
    thumbnail: thumbEmail,
    prompt:
      'Design a transactional welcome email for a design tool called Studio Loop. Use a single-column 600px table-based layout for client compatibility: deep indigo header band with wordmark, friendly greeting, three onboarding steps with small inline SVG glyphs, primary CTA, fallback text link, and a minimal compliance footer. Use light surfaces, indigo accents, system font stack, compact mobile behavior, and no external images or unsupported scripts.',
  },
  {
    id: 'mobile-app',
    category: 'mobile',
    thumbnail: thumbMobile,
    prompt:
      "Design a single mobile app home screen inside a phone frame for a habit tracker called Streak. Show today's date, a hero card for current streak count, four habits with circular progress rings and check buttons, a weekly completion mini-chart, and a bottom tab bar with five icons. Include checked/unchecked states, large touch targets, soft mint background, white cards, charcoal text, and responsive preview framing without external assets.",
  },
  {
    id: 'pricing-page',
    category: 'marketing',
    thumbnail: thumbPricing,
    prompt:
      'Design a pricing page for a developer platform called Arcjet. Show three tiers: Hobby free, Pro $29/mo, Enterprise custom; elevate Pro with a clear Most popular badge. Include monthly/annual segmented toggle, feature comparison table with 10+ rows, FAQ accordion, and a quiet security note. Use dark mode with subtle depth, monospace numerals, generous vertical rhythm, realistic developer-platform copy, responsive stacking, and no fake links or external stock art.',
  },
  {
    id: 'blog-article',
    category: 'document',
    thumbnail: thumbBlog,
    prompt:
      'Design a long-form article page for a design engineering publication called Pixel & Prose. Include a first-viewport hero image area built with CSS/inline SVG, large serif title, author byline with avatar initials and publish date, sticky table of contents sidebar, body text with pull quotes, inline code blocks, footnotes, and a related articles grid. Use a classic editorial light theme, comfortable 680px reading width, mobile-friendly TOC behavior, and no lorem ipsum.',
  },
  {
    id: 'event-calendar',
    category: 'ui',
    thumbnail: thumbCalendar,
    prompt:
      'Design a monthly calendar view component for a team scheduling app. Show a full month grid with today highlighted, colored event pills spanning durations, a mini upcoming-events sidebar, and a header with month navigation arrows, Today button, and team filter. Make events interactive with a detail tooltip/popover and include crowded-day handling. Use clean white surfaces, subtle grid lines, four event colors, accessible focus states, and responsive compression for smaller screens.',
  },
  {
    id: 'chat-interface',
    category: 'mobile',
    thumbnail: thumbChat,
    prompt:
      'Design a messaging app screen inside a phone frame. Show a conversation with sender/receiver text bubbles, timestamps between groups, an image message built from local CSS/SVG placeholders, a typing indicator with three animated dots, contact header with avatar and online status, iOS-style status bar, and bottom input bar with attachment, text field, and send button. Include empty and active input states, polished touch targets, and no external avatar services.',
  },
  {
    id: 'portfolio-gallery',
    category: 'ui',
    thumbnail: thumbPortfolio,
    prompt:
      'Design a photographer portfolio page with a masonry image grid. Use CSS gradient/image-shape placeholders in varied aspect ratios as stand-ins, not external images. Include minimal nav with wordmark, category filter pills, hover overlay with title and camera settings, lightbox-style selected state, and a short availability footer. Use a near-black background, thin borders, restrained typography, smooth hover transitions, and responsive two/three/four-column behavior.',
  },
  {
    id: 'receipt-invoice',
    category: 'document',
    thumbnail: thumbReceipt,
    prompt:
      'Design a print-ready invoice/receipt for a design agency called Studio Neon. Include logo/wordmark area, invoice number and date, billing and shipping addresses side by side, itemized table with 5 realistic line items, subtotal/tax/total breakdown, payment terms, notes, and a thank-you footer. Use clean cream paper, charcoal text, one accent color for totals, A4/Letter-safe proportions, and responsive preview scaling without external assets.',
  },
  {
    id: 'settings-panel',
    category: 'ui',
    thumbnail: thumbSettings,
    prompt:
      'Design a settings page for a SaaS application. Left sidebar categories: Profile, Notifications, Security, Billing, Team, Integrations. Main panel shows Profile with text inputs, avatar upload placeholder, toggles, dropdown select, connected account rows, a red danger zone, breadcrumbs, and Save changes button. Include disabled/dirty states, accessible focus rings, compact mobile stacking, clean form spacing, and no fake navigation links.',
  },
  {
    id: 'auth-signin',
    category: 'ui',
    thumbnail: thumbAuth,
    prompt:
      'Design a sign-in screen for a SaaS product called Lumen. A centered card on a dark star-field CSS background holds product wordmark, Welcome back headline, email and password inputs, primary sign-in button, Forgot password link, OR divider, Google/GitHub/Apple social buttons using text or inline glyphs, and sign-up footer. Include validation/error state styling, clear focus rings, responsive centering, and no external icon or avatar hosts.',
  },
  {
    id: 'kanban-board',
    category: 'ui',
    thumbnail: thumbKanban,
    prompt:
      'Design a kanban board for a product team. Include top bar with project name, board/list toggle, filter chips, and Add task button; then three columns: Backlog, In progress, Done, each with colored header, count pill, and 3-5 task cards. Cards show title, short description, assignee initials stack, due date, and priority tag. Include hover/drag affordances, empty-column state, soft gray canvas, white cards, and responsive horizontal scrolling.',
  },
  {
    id: 'ai-product-hero',
    category: 'marketing',
    thumbnail: thumbAiHero,
    prompt:
      'Design a hero section for an AI writing assistant called Inkwell. Use a deep navy to violet background, an abstract generated-writing visual built with CSS/SVG on the right, a large editorial headline with animated caret, two-line subhead, primary/secondary CTAs, and a small trust row. Make it responsive, avoid generic feature-card filler, use confident editorial typography, and do not use external stock or placeholder images.',
  },
  {
    id: 'weather-card',
    category: 'mobile',
    thumbnail: thumbWeather,
    prompt:
      'Design a mobile weather home screen inside a phone frame. Use a soft sky-blue to indigo gradient, central glass-style weather card with city, current temperature, condition glyph, high/low, 6-hour forecast strip, and a second card for 7-day summary bars. Include loading/error microcopy area, touch-friendly controls for location and units, gentle translucency, readable contrast, and no external icon fonts or weather APIs.',
  },
  {
    id: 'timeline-changelog',
    category: 'document',
    thumbnail: thumbTimeline,
    prompt:
      'Design a product changelog page as a vertical timeline. Add a filter row for All, Features, Fixes, Breaking; an RSS subscribe pill; and four release entries with date, version tag, headline, 2-3 line description, mini-tags, and a highlighted breaking-change callout. Use warm off-white background, serif headings, restrained typography, responsive timeline stacking, realistic release copy, and no lorem ipsum.',
  },
  {
    id: 'stats-counter',
    category: 'animation',
    thumbnail: thumbStatsCounter,
    prompt:
      'Design a stats strip section for a landing page with three animated number counters that count up on scroll into view: 2.4M users, 99.8% uptime, 180 countries. Each stat sits in a translucent card on a deep navy background with its own neon accent glow and small all-caps label. Use IntersectionObserver plus requestAnimationFrame, no JS libraries, include reduced-motion fallback, and keep text readable on mobile.',
  },
  {
    id: 'kinetic-poster',
    category: 'animation',
    thumbnail: thumbKineticPoster,
    prompt:
      'Design a kinetic web poster for a design conference called Motion Matters. The artifact should feel like a live event poster: oversized animated typography, rotating geometric marks, date/location details, speaker chips, and a Register CTA. Include a paused/reduced-motion state, responsive portrait-to-landscape composition, high-contrast editorial colors, CSS/SVG animation only, and no external image or font services.',
  },
  {
    id: 'particle-field',
    category: 'animation',
    thumbnail: thumbParticleField,
    prompt:
      'Create an interactive particle-field landing section for a data infrastructure company called Vector Loom. Show a dark canvas-like hero with 80-120 tiny particles connected by subtle lines, mouse/keyboard-safe hover attraction, headline, short technical subhead, metric chips, and CTA row. Use CSS/Canvas or SVG with no external libraries, provide reduced-motion fallback, and keep content readable across mobile and desktop.',
  },
  {
    id: 'progress-microinteractions',
    category: 'animation',
    thumbnail: thumbProgressMicrointeractions,
    prompt:
      'Design a compact microinteraction lab for progress and completion states in a productivity app. Show five components: upload progress, checklist completion, stepper transition, success confirmation, and retry/error state. Each should have a label, brief usage note, and animated state change triggered by a button. Use accessible status text, calm greens/golds, pure CSS plus small vanilla JS, responsive wrapping, and no external assets.',
  },
  {
    id: 'command-center',
    category: 'ui',
    thumbnail: thumbCommandCenter,
    prompt:
      'Design a command-center interface for an AI operations tool. Include a top search/command bar, left environment rail, main incident timeline, active runbook panel, model/provider status chips, and a right inspector for selected events. Add empty, selected, and warning states. Use dense professional dark UI, clear hierarchy, monospace metadata, keyboard shortcut hints, responsive collapse behavior, and no fake external links.',
  },
  {
    id: 'file-manager',
    category: 'ui',
    thumbnail: thumbFileManager,
    prompt:
      'Design a cloud file manager for a research team. Show toolbar with search, sort, upload, and view toggle; left folder tree; main grid/list of files with type icons, owner initials, modified dates, and selection checkboxes; and a details drawer for the selected file. Include empty folder and multi-select states, accessible focus styling, responsive layout, realistic filenames, and no external icon libraries.',
  },
  {
    id: 'onboarding-wizard',
    category: 'ui',
    thumbnail: thumbOnboardingWizard,
    prompt:
      'Design a four-step onboarding wizard for a team analytics product. Steps: company profile, connect data source, invite teammates, review setup. Include left progress rail, main form area with validation states, inline help, Back/Next controls, final success summary, and mobile stacking. Use calm enterprise styling with one vivid accent, real form labels, accessible errors, and no generic placeholder copy.',
  },
  {
    id: 'checkout-flow',
    category: 'ui',
    thumbnail: thumbCheckoutFlow,
    prompt:
      'Design a checkout flow screen for a premium stationery store. Include cart summary, shipping address form, delivery options, payment method, promo code, order total breakdown, and secure checkout CTA. Show validation/error and selected delivery states. Use refined retail typography, warm paper surfaces, subtle product thumbnails built with CSS, responsive two-column to single-column behavior, and no external product images.',
  },
  {
    id: 'agenda-planner',
    category: 'ui',
    thumbnail: thumbAgendaPlanner,
    prompt:
      'Design a day-agenda planner for a hybrid workshop. Include timeline from 9 AM to 5 PM, session blocks with type chips, speaker initials, room/Zoom labels, conflict warning, and a side panel with selected session details plus Add to calendar button. Use crisp scheduling UI, color-coded session types, keyboard-visible controls, responsive stacking, and realistic session titles.',
  },
  {
    id: 'design-token-inspector',
    category: 'ui',
    thumbnail: thumbDesignTokenInspector,
    prompt:
      'Design a design-token inspector for a product design system. Include token category sidebar, searchable token table, color swatches, typography preview rows, spacing scale visualization, diff badge for changed tokens, and a code export drawer. Show selected token details and empty search state. Use restrained tool UI, clear metadata, accessible contrast, responsive tables, and no external assets.',
  },
  {
    id: 'product-launch-page',
    category: 'marketing',
    thumbnail: thumbProductLaunchPage,
    prompt:
      'Design a product launch page for a collaborative whiteboard called Northstar Canvas. Include first-viewport product signal, launch announcement banner, hero with concrete offer, interactive feature tour, customer quote, launch pricing block, FAQ, and CTA footer. Use bold campaign energy without generic gradient blobs, real product-oriented copy, responsive sections, CSS/SVG visuals, and no stock imagery.',
  },
  {
    id: 'nonprofit-campaign-page',
    category: 'marketing',
    thumbnail: thumbNonprofitCampaignPage,
    prompt:
      'Design a nonprofit campaign page for a community food program. Include hero with donation goal, progress meter, impact stats, story section, volunteer signup, donation tiers, upcoming events, and transparent fund-use breakdown. Use warm human-centered visuals made with CSS/illustrative shapes, clear CTAs, mobile-first layout, truthful non-spammy copy, and no stock photos or placeholder people.',
  },
  {
    id: 'agency-homepage',
    category: 'marketing',
    thumbnail: thumbAgencyHomepage,
    prompt:
      'Design a homepage for a boutique product-design agency called Common Room Studio. Include editorial hero, services index, selected work teasers, process section, team note, contact CTA, and footer. Use sophisticated typography, asymmetrical layout, project thumbnails as CSS compositions, subtle hover states, responsive grid behavior, concrete agency copy, and no generic portfolio filler.',
  },
  {
    id: 'webinar-registration',
    category: 'marketing',
    thumbnail: thumbWebinarRegistration,
    prompt:
      'Design a webinar registration page for a B2B security workshop. Include speaker panel, date/time/timezone, agenda bullets, registration form, trust badges, who-should-attend section, and confirmation state preview. Use professional SaaS styling, clear form validation, responsive layout, realistic copy, inline SVG speaker placeholders, and no hotlinked headshots or logos.',
  },
  {
    id: 'open-source-project-page',
    category: 'marketing',
    thumbnail: thumbOpenSourceProjectPage,
    prompt:
      'Design an open-source project homepage for a local-first developer tool called Pocketbase Studio. Include hero with GitHub CTA, install command block, feature matrix, architecture diagram, community stats, roadmap preview, contributor callout, and license note. Use developer-focused density, monospace code surfaces, responsive command block, truthful project-style copy, and no external scripts.',
  },
  {
    id: 'enterprise-security-page',
    category: 'marketing',
    thumbnail: thumbEnterpriseSecurityPage,
    prompt:
      'Design an enterprise security page for a SaaS platform. Include compliance overview, data-flow diagram, security controls grid, audit-log screenshot mock, trust center links rendered as buttons, customer assurance FAQ, and contact-security CTA. Use quiet professional styling, dense but scannable information architecture, realistic compliance labels, responsive layout, and no fake external destinations.',
  },
  {
    id: 'waitlist-page',
    category: 'marketing',
    thumbnail: thumbWaitlistPage,
    prompt:
      'Design a waitlist page for an AI-native notebook app called Margins. Include succinct product promise, email capture form, invite-code optional field, three concrete use cases, social proof count, privacy note, and submitted-success state. Use intimate editorial styling, subtle paper texture via CSS, polished form states, mobile-first layout, and no external imagery.',
  },
  {
    id: 'annual-report',
    category: 'document',
    thumbnail: thumbAnnualReport,
    prompt:
      'Design a web-first annual report page for a climate-tech nonprofit. Include cover section, letter from director, impact metrics, program highlights, financial allocation chart, partner acknowledgements, and download/report CTA. Use print-inspired editorial layout, data visualizations made in SVG/CSS, realistic numbers with source notes, responsive reading behavior, and no stock photos.',
  },
  {
    id: 'product-brief',
    category: 'document',
    thumbnail: thumbProductBrief,
    prompt:
      'Design a one-page product brief for an internal feature called Smart Routing. Include problem statement, target users, success metrics, scope/non-scope, key flows, risks, rollout checklist, and owner/date metadata. Use clear product-management hierarchy, dense but readable layout, status chips, compact diagrams, print-friendly proportions, and no placeholder names.',
  },
  {
    id: 'resume-cv',
    category: 'document',
    thumbnail: thumbResumeCv,
    prompt:
      'Design a polished resume/CV page for a senior design engineer. Include name/contact header, short profile, experience timeline, selected projects, skills matrix, education, and side column for tools/certs. Use ATS-friendly readable structure, print-safe sizing, subtle accent rules, realistic role content, responsive web preview, and no fake avatar photo.',
  },
  {
    id: 'research-summary',
    category: 'document',
    thumbnail: thumbResearchSummary,
    prompt:
      'Design a research summary page for a user-interview study. Include study title, methodology snapshot, participant breakdown, top five findings, quote cards, opportunity matrix, recommendation checklist, and appendix links rendered as buttons. Use calm evidence-first styling, clear source labels, accessible charts, responsive sections, and no lorem ipsum.',
  },
  {
    id: 'press-kit',
    category: 'document',
    thumbnail: thumbPressKit,
    prompt:
      'Design a press kit page for a startup launch. Include company boilerplate, founder quote, launch facts, product screenshots as CSS mock cards, downloadable asset list, media contact, approved short descriptions, and FAQ. Use media-friendly organization, crisp typography, compact cards, responsive layout, realistic public copy, and no external logos or photos.',
  },
  {
    id: 'finance-ops-dashboard',
    category: 'dashboard',
    thumbnail: thumbFinanceOpsDashboard,
    prompt:
      'Design a finance operations dashboard for a CFO team. Include KPI strip, cash runway trend, burn by department stacked bars, invoice aging table, forecast variance card, and approval queue. Add filters for quarter and entity, warning states for overdue invoices, realistic finance mock data, dense professional light/dark hybrid surfaces, and responsive table handling.',
  },
  {
    id: 'customer-support-dashboard',
    category: 'dashboard',
    thumbnail: thumbCustomerSupportDashboard,
    prompt:
      'Design a customer support dashboard for a CX lead. Include ticket volume trend, SLA breach alert, channel mix chart, sentiment cards, agent leaderboard table, and queue health panel. Show selected filter chips and empty/no-data copy. Use operational SaaS density, blue/coral accents, realistic ticket metrics, accessible tables, and responsive card reflow.',
  },
  {
    id: 'observability-dashboard',
    category: 'dashboard',
    thumbnail: thumbObservabilityDashboard,
    prompt:
      'Design an observability dashboard for an infrastructure team. Include service health grid, latency percentile chart, error-rate sparkline cards, deploy timeline, incident banner, and logs table with severity chips. Use dark terminal-adjacent styling, monospace metadata, clear red/yellow/green status language, realistic service names, responsive overflow handling, and no external chart libraries unless using inline SVG.',
  },
  {
    id: 'ecommerce-inventory-dashboard',
    category: 'dashboard',
    thumbnail: thumbEcommerceInventoryDashboard,
    prompt:
      'Design an ecommerce inventory dashboard for an operations manager. Include stock risk KPI strip, warehouse filter, low-stock table, demand forecast line chart, category distribution bars, purchase-order queue, and product detail drawer. Use warm utilitarian styling, realistic SKUs, warning/healthy states, responsive tables, and no placeholder product photos.',
  },
  {
    id: 'healthcare-appointments-dashboard',
    category: 'dashboard',
    thumbnail: thumbHealthcareAppointmentsDashboard,
    prompt:
      'Design a healthcare appointments dashboard for a clinic coordinator. Include day schedule timeline, provider availability, no-show risk cards, patient check-in queue, room status grid, and follow-up reminders. Use calm clinical colors, privacy-aware mock data, clear status chips, accessible contrast, responsive schedule behavior, and no real patient identifiers.',
  },
  {
    id: 'education-analytics-dashboard',
    category: 'dashboard',
    thumbnail: thumbEducationAnalyticsDashboard,
    prompt:
      'Design an education analytics dashboard for a course administrator. Include enrollment funnel, weekly engagement chart, assignment completion heatmap, at-risk learners table, cohort filters, and intervention suggestions. Use readable academic styling, realistic course labels, empty/filter states, responsive grid, and no generic round-number filler.',
  },
  {
    id: 'creator-analytics-dashboard',
    category: 'dashboard',
    thumbnail: thumbCreatorAnalyticsDashboard,
    prompt:
      'Design a creator analytics dashboard for a video newsletter platform. Include audience growth, retention curve, top posts table, revenue split, sponsor pipeline, and content calendar preview. Use expressive but scan-friendly styling, realistic creator metrics, hover/selected states, responsive card layout, and no external thumbnails.',
  },
  {
    id: 'board-update-deck',
    category: 'presentation',
    thumbnail: thumbBoardUpdateDeck,
    prompt:
      'Design a 6-slide 16:9 board update deck for a Series A SaaS company. Slides: title, company scorecard, revenue and pipeline, product progress, key risks, next-quarter asks. Use executive-level density, consistent footer and slide numbers, charts built in SVG/CSS, realistic but invented metrics, restrained navy/off-white palette, and export-safe fixed slide proportions.',
  },
  {
    id: 'product-roadmap-deck',
    category: 'presentation',
    thumbnail: thumbProductRoadmapDeck,
    prompt:
      'Design a 5-slide product roadmap deck for an internal planning meeting. Slides: strategy theme, now/next/later roadmap, dependency map, launch timeline, decision asks. Use clear swimlanes, priority badges, concise speaker-note style captions in the design, consistent typography, 16:9 layout, and no decorative filler graphics.',
  },
  {
    id: 'workshop-deck',
    category: 'presentation',
    thumbnail: thumbWorkshopDeck,
    prompt:
      'Design a facilitator workshop deck for a 90-minute product discovery session. Include title slide, agenda, ground rules, two exercise slides, break slide, synthesis wall, and closing actions. Use warm collaborative visuals, timer/activity blocks, sticky-note motifs drawn in CSS, clear instructions, 16:9 proportions, and mobile-readable slide thumbnails.',
  },
  {
    id: 'research-readout-deck',
    category: 'presentation',
    thumbnail: thumbResearchReadoutDeck,
    prompt:
      'Design a 7-slide research readout deck summarizing customer interviews. Slides: study overview, participant snapshot, key insight 1, key insight 2, journey friction map, opportunity matrix, recommendations. Use evidence-first editorial styling, quote callouts, simple charts, consistent source notes, 16:9 export-safe layout, and no stock portraits.',
  },
  {
    id: 'sales-proposal-deck',
    category: 'presentation',
    thumbnail: thumbSalesProposalDeck,
    prompt:
      'Design a polished 6-slide sales proposal deck for a cybersecurity platform pitching a mid-market customer. Include cover, customer problem, proposed solution, implementation plan, pricing/package summary, and next steps. Use professional enterprise styling, account-specific placeholder fields, simple architecture diagram, clear CTA, fixed 16:9 proportions, and no fake logos.',
  },
  {
    id: 'digest-newsletter',
    category: 'email',
    thumbnail: thumbDigestNewsletter,
    prompt:
      'Design a weekly digest newsletter email for a project management app. Use a 600px email-safe layout with header, personalized intro, three project updates, upcoming deadlines table, product tip, and footer preferences. Use table-friendly structure, inline SVG/CSS-safe accents, clear mobile stacking, realistic copy, and no external images or scripts.',
  },
  {
    id: 'payment-reminder-email',
    category: 'email',
    thumbnail: thumbPaymentReminderEmail,
    prompt:
      'Design a polite payment reminder email for an invoicing product. Include invoice summary card, due date, amount, payment CTA, secondary support link, itemized mini-table, and reassurance copy. Show overdue emphasis without alarmist tone. Use 600px table-based layout, accessible button contrast, mobile-safe spacing, realistic billing copy, and no external assets.',
  },
  {
    id: 'product-update-email',
    category: 'email',
    thumbnail: thumbProductUpdateEmail,
    prompt:
      'Design a product update email announcing three new collaboration features. Use 600px single-column layout with hero headline, release summary, three feature blocks, screenshot mockups made with CSS, changelog link button, and footer. Keep copy concise, include alt text/fallback text, support mobile email clients, and avoid external hosted images.',
  },
  {
    id: 'mobile-banking-app',
    category: 'mobile',
    thumbnail: thumbMobileBankingApp,
    prompt:
      'Design a mobile banking home screen inside a phone frame. Include account balance card, quick actions, recent transactions, spending insight card, security status, and bottom tab bar. Show masked account data, positive/negative transaction states, biometric prompt affordance, high-contrast financial UI, generous touch targets, and no real bank logos or external icons.',
  },
  {
    id: 'food-delivery-tracker',
    category: 'mobile',
    thumbnail: thumbFoodDeliveryTracker,
    prompt:
      'Design a food delivery tracking screen inside a phone frame. Include order status timeline, courier location map drawn as CSS/SVG, ETA card, restaurant/order summary, contact/support buttons, and bottom sheet with items. Show active/in-transit state, warm food-app palette, large touch targets, responsive phone framing, and no external maps or food photos.',
  },
  {
    id: 'fitness-workout-builder',
    category: 'mobile',
    thumbnail: thumbFitnessWorkoutBuilder,
    prompt:
      'Design a mobile workout builder screen inside a phone frame. Include weekly goal header, exercise search, draggable workout blocks, intensity selector, rest timer chip, progress summary, and save CTA. Show selected and empty states, energetic but readable styling, accessible controls, realistic exercise names, and no external fitness imagery.',
  },
  {
    id: 'ipad-magazine-reader',
    category: 'mobile',
    thumbnail: thumbIpadMagazineReader,
    prompt:
      'Design an iPad magazine reader for a long-form culture publication. Use a tablet-oriented layout with a two-page spread feel: cover story rail, article cards, reading progress, typography controls, saved/bookmarked state, and a side table of contents. The composition should stress tablet breakpoints, editorial typography, horizontal space, and readable long-form content without relying on external photos.',
  },
  {
    id: 'watch-run-coach',
    category: 'mobile',
    thumbnail: thumbWatchRunCoach,
    prompt:
      'Design an Apple Watch-style run coach screen for a fitness app. The tiny viewport should show current distance, pace ring, heart-rate zone, haptic cue state, pause/resume controls, and one glanceable coaching message. Prioritize 44px-equivalent tap targets, ultra-short copy, strong contrast, circular progress geometry, and a reduced-motion-friendly pulse animation.',
  },
  {
    id: 'android-wallet-screen',
    category: 'mobile',
    thumbnail: thumbAndroidWalletScreen,
    prompt:
      'Design an Android wallet home screen for transit and payment cards. Include stacked cards, tap-to-pay ready state, recent transit rides, add-card CTA, security notice, and bottom navigation. Use Material-adjacent spacing without copying Google branding, show disabled/offline states, keep touch targets large, and use inline SVG/CSS card art instead of external logos.',
  },
  {
    id: 'foldable-travel-planner',
    category: 'mobile',
    thumbnail: thumbFoldableTravelPlanner,
    prompt:
      'Design a foldable-phone travel planner that changes meaning between closed and open states. Show itinerary summary on the left pane and map/detail planning on the right pane, with drag-to-reschedule affordances, weather badges, hotel/flight cards, and conflict warnings. The design should test dual-pane layouts, hinge-safe spacing, responsive collapse, and realistic travel content without external maps.',
  },
  {
    id: 'vision-pro-spatial-gallery',
    category: 'ui',
    thumbnail: thumbVisionProSpatialGallery,
    prompt:
      'Design a spatial gallery interface for a Vision Pro-style art archive. Show floating panels with artwork metadata, a central selected object, depth cues, translucent surfaces, hand-friendly controls, and a curator notes drawer. Keep it as a web artifact using CSS transforms and layered cards, not real 3D; include focus/selected states and avoid decorative glass for its own sake.',
  },
  {
    id: 'safari-product-tour',
    category: 'marketing',
    thumbnail: thumbSafariProductTour,
    prompt:
      'Design a product tour shown inside a macOS Safari browser frame for a privacy-focused notes app. Include browser chrome, URL/title area, a hero tour step, three annotated UI callouts, step navigation dots, and a final Start trial CTA. The task should test browser scaffolds, responsive iframe-safe layout, annotation placement, and non-generic product copy.',
  },
  {
    id: 'arc-research-browser',
    category: 'ui',
    thumbnail: thumbArcResearchBrowser,
    prompt:
      'Design an Arc-style research browser workspace for an analyst comparing market reports. Include a left sidebar of spaces/tabs, command bar, split content pane, source cards, extracted quotes, and a citation queue. Show selected and empty citation states, keyboard shortcut hints, dense reading UI, and no hotlinked screenshots.',
  },
  {
    id: 'terminal-release-monitor',
    category: 'ui',
    thumbnail: thumbTerminalReleaseMonitor,
    prompt:
      'Design a terminal-style release monitor for a developer tool. It should look like a focused CLI dashboard with build, test, package, notarize, and deploy stages, streaming log rows, progress bars, retry command suggestions, and a final release summary. Use monospace hierarchy, realistic command text, pass/fail/warn states, and keyboard-first interaction hints.',
  },
  {
    id: 'vscode-extension-marketplace',
    category: 'ui',
    thumbnail: thumbVscodeExtensionMarketplace,
    prompt:
      'Design a VS Code extension marketplace detail screen for an AI refactoring extension. Include editor chrome, activity bar, extension icon, install button, version/changelog tabs, feature list, rating breakdown, permissions notice, and a code preview panel. This should test dev-mockup scaffolds, tab behavior, dense metadata, and polished dark editor styling.',
  },
  {
    id: 'drawer-inspector',
    category: 'ui',
    thumbnail: thumbDrawerInspector,
    prompt:
      'Design a bottom-drawer inspector for selecting a component on a canvas. The page should show a muted design canvas with a selected element, then a bottom sheet with handle, component name, editable properties, token chips, actions, and validation messages. Include open/closed state, scrim behavior, keyboard focus, and mobile-safe drawer height.',
  },
  {
    id: 'toast-notification-center',
    category: 'ui',
    thumbnail: thumbToastNotificationCenter,
    prompt:
      'Design a toast notification center for a project management app. Show a stack of success, warning, error, and undo toasts; include dismiss buttons, progress timeout bars, grouped notifications, and a compact history drawer. The artifact should test transient UI, z-index layering, status color semantics, motion timing, and reduced-motion behavior.',
  },
  {
    id: 'skeleton-loading-dashboard',
    category: 'dashboard',
    thumbnail: thumbSkeletonLoadingDashboard,
    prompt:
      'Design a dashboard loading-state study for an analytics product. Show the real dashboard shell plus three stages: skeleton cards while metrics load, progressive chart reveal, and a timeout error card with Retry CTA. The skeleton geometry must match final content shapes; include status text, no full-screen spinner, and a final loaded preview section for comparison.',
  },
  {
    id: 'empty-state-library',
    category: 'ui',
    thumbnail: thumbEmptyStateLibrary,
    prompt:
      'Design a small empty-state library for a SaaS app. Include three variants side by side: first-use, no-results, and error. Each variant needs distinct illustration, headline, body copy, primary action, secondary action when appropriate, and accessibility-friendly status text. Avoid generic "No data" copy and make each state fit a concrete feature such as invoices, search, or sync.',
  },
  {
    id: 'file-tree-code-review',
    category: 'ui',
    thumbnail: thumbFileTreeCodeReview,
    prompt:
      'Design a code review file-tree interface for a design engineering team. Include collapsible folders, changed-file badges, diff status colors, selected file preview, comment count chips, filter/search, and an empty filter state. The design should stress file-tree scaffold behavior, dense text alignment, keyboard navigation, and readable code metadata.',
  },
  {
    id: 'cjk-editorial-longform',
    category: 'document',
    thumbnail: thumbCjkEditorialLongform,
    prompt:
      'Design a Chinese long-form reading page on the topic "interfaces in urban space." The artifact should intentionally stress CJK typography: title, subtitle, author metadata, table of contents, body paragraphs, footnotes, pull quote, figure captions, and related articles. Handle body line-height, punctuation rhythm, mixed Chinese/English product names, and mobile line breaks carefully. It should feel like a Chinese design magazine, not an English template translated word-for-word.',
  },
  {
    id: 'bilingual-event-page',
    category: 'marketing',
    thumbnail: thumbBilingualEventPage,
    prompt:
      'Design a bilingual event page for a design systems meetup in Shanghai. The page must mix Chinese and English naturally: hero, date/location, agenda, speaker cards, sponsor strip, registration form, and FAQ. Test CJK typography, mixed-script spacing, form layout, mobile wrapping, and realistic bilingual copy without machine-translation awkwardness.',
  },
  {
    id: 'stripe-brand-checkout',
    category: 'ui',
    thumbnail: thumbStripeBrandCheckout,
    prompt:
      'Design a Stripe-branded checkout settings page for a marketplace seller, using the built-in Stripe brand reference if available. Include payout account status, payment method toggles, tax settings, dispute alert, fee breakdown chart, and a test-mode banner. The result should test brand reference loading, form layout, chart rendering, and enterprise-grade financial UI density.',
  },
  {
    id: 'linear-roadmap',
    category: 'dashboard',
    thumbnail: thumbLinearRoadmap,
    prompt:
      'Design a Linear-branded roadmap dashboard for a product team, using the built-in Linear brand reference if available. Include cycles, initiatives, project health, issue counts, team filters, dependency warnings, and a selected initiative drawer. The design should test brand-system inheritance, dense workflow UI, empty/blocked states, and a restrained dark surface system.',
  },
  {
    id: 'notion-knowledge-base',
    category: 'document',
    thumbnail: thumbNotionKnowledgeBase,
    prompt:
      'Design a Notion-branded team knowledge-base page, using the built-in Notion brand reference if available. Include wiki homepage layout, page tree, recently updated docs, owner badges, search empty state, onboarding checklist, and a template gallery. The output should test document hierarchy, file-tree navigation, empty states, and subtle productivity-app styling.',
  },
  {
    id: 'spotify-campaign-page',
    category: 'marketing',
    thumbnail: thumbSpotifyCampaignPage,
    prompt:
      'Design a Spotify-branded campaign page for an end-of-year creator recap, using the built-in Spotify brand reference if available. Include hero, animated listening-stat cards, genre breakdown chart, share-card preview, artist quote, and CTA. The task should test brand color discipline, animated stats, social-share surfaces, and media-product energy without external album art.',
  },
  {
    id: 'shopify-merchant-dashboard',
    category: 'dashboard',
    thumbnail: thumbShopifyMerchantDashboard,
    prompt:
      'Design a Shopify-branded merchant operations dashboard, using the built-in Shopify brand reference if available. Include order volume, fulfillment queue, inventory risk, conversion funnel, top products table, payout card, and a drawer for selected order details. This should stress ecommerce data, brand references, chart rendering, tables, and operational empty/error states.',
  },
  {
    id: 'ibm-enterprise-report',
    category: 'document',
    thumbnail: thumbIbmEnterpriseReport,
    prompt:
      'Design an IBM-branded enterprise AI governance report page, using the built-in IBM brand reference if available. Include executive summary, risk matrix, model inventory table, audit timeline, policy controls, and downloadable appendix CTA. The design should test brand reference use, dense report composition, tables, charts, and sober enterprise typography.',
  },
  {
    id: 'raycast-launcher',
    category: 'ui',
    thumbnail: thumbRaycastLauncher,
    prompt:
      'Design a Raycast-branded command launcher for switching between design resources, using the built-in Raycast brand reference if available. Include search input, grouped commands, keyboard shortcuts, recent actions, empty search state, toast feedback after running a command, and a compact preferences drawer. This should stress cmdk, keyboard UX, toast, drawer, and brand styling.',
  },
  {
    id: 'calcom-booking-flow',
    category: 'ui',
    thumbnail: thumbCalcomBookingFlow,
    prompt:
      'Design a Cal.com-branded booking flow for a design consultant, using the built-in Cal.com brand reference if available. Include profile header, service selection, calendar availability grid, timezone selector, attendee form, confirmation state, and reschedule/cancel links. This should test form-layout, calendar interaction, empty time slots, mobile responsiveness, and brand inheritance.',
  },
];

const REGISTRY: Record<Locale, Record<string, ExampleContent>> = {
  en: enExamples,
  es: esExamples,
  'pt-BR': ptBRExamples,
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
    const { prompt, ...localizedContent } = content;
    return { ...ex, ...localizedContent, prompt: prompt ?? ex.prompt };
  });
}

export function getExample(id: string, locale?: string): LocalizedExample | undefined {
  return getExamples(locale).find((e) => e.id === id);
}
