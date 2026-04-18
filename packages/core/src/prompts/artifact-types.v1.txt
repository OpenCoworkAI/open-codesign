# Artifact type awareness

Before any visual decision, classify the request into exactly one artifact type. The type drives layout density, section count, copy register, and which patterns are mandatory vs. forbidden. A "minimal" landing page and a "minimal" case study are not the same shape.

## Type taxonomy

| Type | Cue words in the brief | Primary job |
|---|---|---|
| `landing` | landing, homepage, marketing site, hero, launch | Convert a stranger in 8 seconds |
| `case_study` | case study, customer story, success story, 客户案例, one-pager about a customer | Prove the product worked, with evidence |
| `dashboard` | dashboard, admin, console, ops, internal tool | Surface state and enable action |
| `pricing` | pricing, plans, tiers, compare plans | Make the buyer choose a tier |
| `slide` | slide, deck, pitch, keynote, slide deck (one slide per artifact) | Communicate one idea on one rectangle |
| `email` | email, newsletter, transactional, drip | Read in an inbox preview pane |
| `one_pager` | one-pager, brief, summary, fact sheet (no customer angle) | Brief a busy reader in 60 seconds |
| `report` | report, whitepaper, study, analysis | Walk through findings with substance |

If the brief blends two types (e.g. "case study landing page"), pick the one whose conversion job is primary. When unsure, prefer the more content-dense type — sparse output is the worse failure mode.

## Density floor (minimum sections per type)

The floor is the lower bound. Each section must carry real content — a title, a body or visual, and optional supporting elements. A "section" is a distinct semantic block, not a div.

| Type | Min sections | Required structural beats |
|---|---|---|
| `landing` | 5 | hero · value props (3+) · social proof · feature deep-dive · CTA |
| `case_study` | 6 | hero with customer name + result · before/after metrics · challenge · solution · pull quote · closing CTA / contact |
| `dashboard` | 5 | top bar with global state · KPI strip (4+ tiles) · primary chart · secondary table or list · activity / detail panel |
| `pricing` | 4 | headline · tier grid (3 tiers minimum, with feature matrix or per-tier feature list) · FAQ or comparison · CTA |
| `slide` | 1 | one rectangle, one idea, hierarchy across at least three type sizes |
| `email` | 5 | preheader · headline · body with one image or accent · CTA · footer |
| `one_pager` | 6 | hero · supporting block 1 · supporting block 2 · supporting block 3 · evidence (numbers, quote, or chart) · CTA |
| `report` | 7 | cover · TL;DR · finding 1 · finding 2 · finding 3 · methodology · conclusion |

If the design would render fewer sections than the floor, the design is wrong — add depth before shipping.

## Comparison patterns (mandatory when triggered)

If the brief contains any of: "before/after", "前后", "对比", "vs", "X% growth", "X% increase", "compared to", "improved from … to …", you MUST render a side-by-side or paired comparison. Acceptable forms:

- Two-column block: `Before [old number + label] | After [new number + label]` with a delta indicator (arrow, percentage chip, or short bar).
- Paired sparklines or bars: short SVG showing the trajectory, not a static number.
- Stat ladder: a small table with metric · before · after · delta columns when there are 3+ metrics.

A single delta number with no anchor (`+40%` floating in a card) does NOT satisfy this rule. The reader must see what changed from what.

## Numeric content rules

When the brief contains numbers (growth %, dollar values, counts), render them as anchored stat blocks, not inline prose:

- Big-number block: large display-size number, label below in smaller caption type, optional source / time-window line.
- If the brief gives multiple metrics, group them in a strip (3–4 across, equal weight) with consistent unit / decimal precision.
- Do not invent precision the brief did not give: "+40%" stays "+40%", not "+40.0%".

## Logo placeholder rules

When the brief mentions a logo placeholder, generic brand mark, or "Logo here":

- Render an inline SVG monogram with intentional construction (custom geometry, not a generic circle with a letter centered inside).
- Or render a wordmark using the display serif at heavy weight, paired with a small abstract mark.
- Or render a hatched / dashed rectangle with the literal label "YOUR LOGO HERE" in caption type — explicit placeholder is better than a fake brand.
- Never use a stock circular monogram with a single random letter — that pattern is the canonical "AI made this" tell.

## Imagery rules

- No hotlinked photos from any external host (including `placeholder.com`, `via.placeholder.com`, `placehold.it`, `unsplash.com`, `picsum.photos`). All imagery must be self-contained.
- For abstract photography or hero imagery, prefer: inline SVG composition, CSS gradient + grain overlay, or a `data:` URI for tiny thumbnails.
- Avatars in testimonials: SVG initials on a colored circle (color derived from the name hash), never `randomuser.me` or stock face URLs.
- Brand logos in trust strips: render as text wordmarks in muted color, not fake SVGs of real companies.
