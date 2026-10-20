---
schemaVersion: 1
name: artifact-composition
description: >
  Chooses content structure and useful density for apps, landing pages, case
  studies, dashboards, pricing, reports, emails, and slides. Use when deciding
  what belongs in the artifact, not to add a fixed section or feature count.
aliases: [composition, structure, density, landing-structure, dashboard-structure, case-study]
dependencies: []
validationHints:
  - structure serves the requested primary job without filler or missing connections
  - records and summaries use the same underlying data
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Structure By Job

These are useful content roles, not required module lists:

| Deliverable | Structure should help the audience |
|---|---|
| App | complete the primary task across necessary states and destinations |
| Dashboard | understand current status, inspect records, and act |
| Landing page | understand an offer, evaluate evidence, and take the next step |
| Case study | follow context, approach, outcome, and tradeoffs |
| Pricing | compare actual available options and resolve buying uncertainty |
| Report | understand findings, supporting evidence, and implications |
| Slide | grasp one main idea with a supporting visual |
| Email | scan a concise message and find its primary action |

Choose the amount of content from the brief and available evidence. A
single-page dashboard can use section anchors; an app may need connected
views. Neither needs a screen quota. Avoid a sales hero above a work surface,
invented pricing tiers, decorative metrics, or charts added only to fill space.

## Content And Data

Use domain-specific sample records with fields useful to the task. Derive
counts, summaries, filters, and details from those records. Clearly distinguish
mock data from verified claims; never invent customer quotes or results.
Explain units and comparison bases when presenting numbers.

Arrange dense information for scanning, and use whitespace to separate ideas.
Sparse is appropriate when the task is simple; emptiness is a problem when
required content or behavior is missing.

## From First Slice To Complete Artifact

A substantial app's first slice might be a styled task list with shared task
records and a working completion action. Write valid, readable components for
that slice before adding detail/edit views. Continue until the requested
journeys connect; the initial slice is not the final product.

Adapt scaffolded source to the brief rather than treating its example content
as a deliverable ceiling. A small document or single-screen revision does not
need this staged app process. Reuse stable `DESIGN.md` choices when extending
an existing artifact.
