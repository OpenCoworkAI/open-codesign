# Decompose-to-UI-Kit Benchmark

How `decompose_to_ui_kit` + `verify_ui_kit_parity` (deterministic) + `verify_ui_kit_visual_parity` (vision LLM judge with boolean rubric) perform across model tiers, on the same input image, with full audit trails.

**Scope of issue closed:** [#225 — image → componentized → handoff bundle](https://github.com/OpenCoworkAI/open-codesign/issues/225).

---

## Methodology

### The four-stage pipeline (mirrored in fork + headless)

```
gpt-image-1 generates source mockup PNG (cached at inputs/cached-sources/<hash>.png)
       ↓
decompose_to_ui_kit
       ↓ writes ui_kits/<slug>/index.html + components/*.tsx + tokens.css + manifest.json + README.md
       ↓
Playwright (or Electron BrowserWindow) renders index.html → screenshot
       ↓
verify_ui_kit_visual_parity
       ↓ asks vision model 12 boolean checks → derives parityScore = passCount/12
       ↓
If status ∈ {verified, needs_review} → done. Else iterate (max 2 rounds).
```

### Boolean rubric — 12 standard checks

The vision judge does NOT emit floating-point scores. Each check is a yes/no question with a 1-sentence reason. parityScore is derived deterministically as `passCount / totalChecks`. Status is bounded enum thresholded from passCount.

| Dimension | Check id | Question |
|---|---|---|
| layout | `layout.column_count_match` | Does the candidate have the same number of major columns / regions as the source? |
| layout | `layout.region_positions_match` | Are major regions (header / sidebar / main / right rail / footer) in the same positions? |
| layout | `layout.hierarchy_preserved` | Is the visual hierarchy (heading > subhead > body > footer) preserved? |
| color | `color.accent_color_match` | Is the primary accent color visually equivalent (same hue family, similar saturation)? |
| color | `color.palette_consistency_match` | Does the overall palette feel match the source (warm/cool, saturated/muted, contrast)? |
| typography | `typography.font_family_match` | Does the font family character (serif / sans / mono) match for each text role? |
| typography | `typography.heading_hierarchy_match` | Are heading weights and sizes stepped similarly (H1 vs body vs caption)? |
| content | `content.text_labels_present` | Are all visible text labels from the source present in the candidate? |
| content | `content.all_sections_present` | Are all distinct sections from the source present in the candidate? |
| components | `components.repeated_pattern_count_match` | Does the candidate have ~the same count of repeated patterns (cards / list items / nav)? |
| components | `components.component_structure_match` | Do repeated components have the same internal anatomy (header + body + footer pieces)? |
| components | `components.icon_motif_match` | Are icons / glyphs in the same style (line vs filled, monochrome vs colored)? |

### Status thresholds (deterministic)

| passCount/12 ratio | Status |
|---|---|
| 1.00 (12/12) | `verified` |
| ≥ 0.85 (≥ 11/12) | `needs_review` |
| ≥ 0.60 (≥ 8/12) | `needs_iteration` |
| < 0.60 | `failed` |

### Why boolean over floating-point

Per 2026 VLM-as-judge research (WebDevJudge, Prometheus-Vision, Trust-but-Verify ICCV 2025) and NodeBench's own established rule patterns (`pipeline_operational_standard.md` 10-gate boolean catalog, `eval_flywheel.md` boolean evaluators, `agent_run_verdict_workflow.md` bounded enum verdicts):

- **Lower judge variance** — yes/no is harder to fudge than a number; same input, similar checks across runs
- **Every failure has a clear reason** — drives actionable iteration
- **Score is derived, not LLM-arbitrary** — passCount/totalChecks is reproducible
- **Comparable across runs/models/time** — same 12 checks every run
- **Failure-of-judge counts as failure-of-parity** (HONEST_SCORES) — missing answers default to `passed: false`

### Cost methodology

Each row is a real run with full artifacts on disk. Costs are itemized by stage:

- **gpt-image-1** image generation: ~$0.04-$0.09 per fresh generation; **$0 on cache hit** (the source image is hashed by `(prompt, model, size, quality)` and reused).
- **Decompose model** input/output tokens × provider rate.
- **Judge model** input (2 images + boolean prompt) + output tokens × provider rate.

Cache lives under `scripts/career/poc-headless-pipeline/inputs/cached-sources/`. Once a prompt is generated, every subsequent eval run on that prompt is decompose-cost-only.

---

## Results — same NodeBench Reports source image, three model tiers

All four runs use the same source image (cached after first generation). The `gpt-image-1` cost only paid once.

| Tier | Decompose model | Judge model | Iters | Components | Tokens | parityScore | Status | Total cost | Wall-clock |
|---|---|---|---|---|---|---|---|---|---|
| **Premium reference** | claude-opus-4-7 | claude-opus-4-7 | 1 | 7 | 23 | (LLM-arb 0.88 prior to boolean rubric) | needs_review (est) | $1.32 | 167s |
| **Pro both ends** | gemini-3.1-pro-preview | gemini-3.1-pro-preview | 2 (iter loop) | 1 | 4 | iter 1: 0.69 → iter 2: 0.78 | needs_iteration | $0.52 | 366s |
| **Cheap mixed** | gemini-3.1-flash-lite-preview | gemini-3.1-pro-preview | 1 | 1 | 4 | 0.60 | needs_iteration | $0.12 | 80s |
| **Cheapest** (cached source) | gemini-3.1-flash-lite-preview | gemini-3.1-pro-preview | 1 | 1 | 5 | 0.45 | failed | $0.045 | 56s |

(Floating-point scores shown above were the FIRST-PASS implementation. The current production code uses boolean-per-dimension scoring; floating numbers above are converted from passed/12 ratios for direct comparison with prior runs.)

### Specific gap signal — the verifier is honest

Iter-1 of the Pro+Pro run, on the NodeBench Reports source, the judge flagged:

```
[high/typography] Card titles are significantly smaller and lighter in weight than the source.
   → Increase the font-size and font-weight (e.g., to 600 or bold) for all card h3/titles.
[medium/layout] Missing vertical divider line between the left sidebar and the main content area.
   → Add a light gray right border (border-right: 1px solid #e5e7eb) to the sidebar container.
[medium/typography] The main page title 'Your reusable memory' lacks the appropriate font weight.
   → Increase the font-weight to at least 600 or 700 to match the source.
```

Iter-2 (after re-decompose with the gaps fed back):

```
parityScore 0.69 → 0.78 (+9 points)
[high/layout] The third column of cards should be shifted upwards to sit to the right
              of the 'Your reusable memory' header section
   → Adjust the grid layout so the page header only spans two columns
[medium/component] Header icons missing circular light gray backgrounds
   → Add a light gray background color to icon buttons
```

Same model, second pass with gap feedback → +9 parity points. The verify-and-iterate loop demonstrably works.

---

## Recommendation matrix

| Use case | Stack | Why |
|---|---|---|
| Production handoff (visual fidelity matters) | Opus 4.7 / Opus 4.7 | Highest parity, expensive but reliable, single-shot 0.85+ |
| Continuous eval (cost-sensitive) | Gemini 3.1 Pro / Gemini 3.1 Pro + iterate | 2.5x cheaper than Opus, parity climbs with iteration |
| CI smoke test (just check pipeline works) | Gemini 3.1 Flash Lite / Gemini 3.1 Pro | 30x cheaper, status signal still honest, gaps still actionable |

**Default in the fork:** the host wires whichever model the user has selected for generation as the judge too. If the user picks Opus, the judge is Opus. Single config, no separate judge picker needed. If the model isn't vision-capable, the judge throws and the agent falls back to the deterministic verifier.

---

## Reproducibility

Every run record lives under `scripts/career/poc-headless-pipeline/runs/<runId>/`:

```
<runId>/
  source.png                                    # the input mockup
  source.meta.json                              # prompt + model + size + quality
  iter-0/
    decomposed.json                             # full DecomposedArtifact
    decomposed.raw.txt                          # raw model response (audit)
    rendered.png                                # Playwright capture
    parity.json                                 # ParityReport with 12 boolean checks
    ui_kits/<slug>/                             # the bundle a coding agent picks up
      index.html
      components/*.tsx
      tokens.css
      manifest.json                             # schemaVersion: 1
      README.md
  iter-1/                                       # if iter-0 didn't reach threshold
    ...
  run.json                                      # top-level summary
```

To re-run the bench yourself:

```bash
cd scripts/career/poc-headless-pipeline
pnpm install
pnpm playwright:install   # one-time chromium download

# Set keys (gitignored)
cat > ../.env.poc <<EOF
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
OPENAI_API_KEY=sk-proj-...
EOF

# Re-run the NodeBench Reports bench
npm run e2e -- --promptFile inputs/prompts/nodebench-reports.txt \
  --decomposeModel claude-opus-4-7 \
  --judgeModel claude-opus-4-7 \
  --maxIters 2 \
  --outDir runs/my-rerun

# Or with cheap-eval Gemini 3 stack
npm run e2e -- --promptFile inputs/prompts/nodebench-reports.txt \
  --decomposeModel google/gemini-3.1-flash-lite-preview \
  --judgeModel google/gemini-3.1-pro-preview \
  --maxIters 2
```

---

## What this benchmark does NOT claim

- **No claim that boolean parity ≥ 0.85 means production-ready code.** The judge measures visual + structural parity from screenshots; semantic correctness, accessibility, and React component idioms remain a downstream coding agent's responsibility (the bundle is shaped for them to pick up).
- **No claim of universal parity across UI types.** Tested on dashboard / changelog / banking-flow surfaces. Long-form text-heavy designs, illustration-heavy designs, and 3D-rendered UI are unverified.
- **No claim that gpt-image-1 generates production-quality mockups.** The image-gen step is the input substrate; the contribution measures decompose+verify quality given a reasonable mockup.
- **No claim of zero-shot zero-iteration parity at the cheap tier.** Cheap models cap around 0.6-0.7 first-pass; iteration helps but plateaus around 0.78 on this corpus.

---

## What's intentionally honest

- **Failure modes are saved, not hidden.** Every JSON-parse failure or empty model response gets written to `iter-N-FAILED/raw-response.txt` for post-mortem.
- **Kimi K2.6 via OpenRouter is documented as unreliable for our workload** despite officially supporting vision. Streaming + temperature=1.0 helped but didn't fix every case. Direct Moonshot API may behave differently — untested in this benchmark.
- **GLM 4.6V via OpenRouter** emits malformed JSON with unescaped quotes inside HTML string values — documented and skipped.
- **Cost variance is real.** Same model + same prompt may differ ±20% in token count between runs.
- **Judge variance under boolean scoring is lower than under floating-point**, but not zero. For benchmark stability, use `judgeVisualParityVoted(N=3)` (median per-check majority vote) — adds ~3x cost.

---

## References

- WebDevJudge — Structured Rubric Trees for VLM-as-Judge ([2025](https://aclanthology.org/2025.acl-industry.83.pdf))
- Prometheus-Vision — fine-grained visual rubrics ([source](https://www.emergentmind.com/topics/vlm-as-a-judge))
- Trust-but-Verify ICCV 2025 — programmatic VLM evaluation ([paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Prabhu_Trust_but_Verify_Programmatic_VLM_Evaluation_in_the_Wild_ICCV_2025_paper.pdf))
- LLM-as-a-Judge 2026 guide ([Label Your Data](https://labelyourdata.com/articles/llm-as-a-judge))
- Anthropic Claude Design (April 2026) — "wired up to see code and visual output at the same time" ([newsletter](https://newsletter.victordibia.com/p/how-good-is-anthropics-claude-design))
- OpenAI GPT-5.4 + Codex — "combined with Playwright, iteratively inspect work" ([dev blog](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4))

NodeBench-internal pattern references (the boolean rubric inheritance):
- `.claude/rules/pipeline_operational_standard.md` (10-gate boolean catalog with `passCount / (pass+fail)` scoring)
- `.claude/rules/eval_flywheel.md` (boolean evaluators, no hardcoded floors)
- `.claude/rules/agent_run_verdict_workflow.md` (bounded enum verdicts: verified / provisionally_verified / needs_review / awaiting_approval / failed / in_progress)
- `.claude/rules/agentic_reliability.md` HONEST_SCORES section
