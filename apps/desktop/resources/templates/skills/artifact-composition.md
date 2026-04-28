---
schemaVersion: 1
name: artifact-composition
description: >
  Classifies design artifacts and sets the right density, section ladder,
  metrics treatment, and comparison structure. Use for landing pages, case
  studies, dashboards, pricing pages, reports, one-pagers, emails, or slides.
aliases: [composition, structure, density, landing-structure, dashboard-structure, case-study]
dependencies: []
validationHints:
  - final artifact has a complete section ladder for its artifact type
  - dense operational surfaces include records, filters, tables, or states
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Artifact Type

Before visual styling, classify the artifact by its primary job and choose the
composition skeleton. The same visual style cannot serve every artifact type.

| Type | Job |
|---|---|
| landing | convert a stranger quickly with one offer |
| case_study | prove an outcome with evidence and sequence |
| dashboard | orient, diagnose, and enable action |
| pricing | make the buyer choose a tier confidently |
| slide | communicate one idea on one rectangle |
| email | scan well in a narrow inbox pane |
| one_pager | brief a busy reader in 60 seconds |
| report | walk through findings with substance |

## Density

Sparse output is the common failure mode. Pick the correct section ladder:

- Landing: hero, problem, solution/product proof, 3-5 differentiated features, social proof, pricing or CTA band, footer.
- Case study: customer/result hero, customer profile, challenge, approach, before/after metrics, quote, implementation timeline, CTA.
- Dashboard: app shell, global filters, KPI strip, primary chart, secondary chart/table, activity/detail panel, empty/loading state.
- Pricing: headline, 3+ tiers, plan comparison, risk reducer/FAQ, CTA.
- Report/one-pager: cover, TL;DR, 3 findings, evidence modules, methodology, conclusion.
- Slide: one conclusion, one supporting visual, one footer note; never cram a page into a slide.
- Email: subject/preheader mental model, headline, short body, one primary action, fallback link.

## Evidence

- Put important metrics in large labeled blocks.
- Render before/after, vs, 对比, or growth claims as paired comparisons, not floating deltas.
- Use realistic numbers and dates; avoid 100%, 1,000, Jan 1 2020, and lorem-style filler.
- Mock records should feel operational: each row/card should carry at least 5 useful fields such as owner, status, trend, date, segment, severity, or next action.

## Composition Rules

- Marketing artifacts need rhythm: alternate dense sections with air, text-led sections with visual-led sections, and proof with promise.
- Product tools need utility density: no oversized hero, no decorative feature grid, no landing-page copy above the work surface.
- Case studies need credibility: include who the customer is, what changed, how long it took, and what tradeoff was solved.
- Use `TWEAK_DEFAULTS` for 2-6 axes a user would actually tune: accent, density, radius, motion, chart mode, or surface contrast.
- If multiple screens are implied, update or create `DESIGN.md` so later screens inherit tokens, component names, and layout rules.

## Forbidden Skeletons

- Landing: hero + three identical cards + testimonial + CTA, with no product proof.
- Case study: four metric cards and a quote, with no challenge/approach/before-after structure.
- Dashboard: stat cards floating over a marketing background, with no filters, table, or actionable state.
- Pricing: three cards with vague plan names and no comparison or buying-risk reducer.
- Slide/report: giant headline plus decorative chart with no takeaway.
