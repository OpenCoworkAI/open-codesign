/**
 * verify-ui-kit-visual-parity — vision-LLM judge with BOOLEAN-per-dimension scoring.
 *
 * Pairs with the deterministic verify_ui_kit_parity. The deterministic verifier
 * reads HTML/CSS strings and computes structural signals; this one renders the
 * decomposed index.html, screenshots it, and asks a multimodal model to compare
 * against the source artifact.
 *
 * Scoring methodology — BOOLEAN per dimension, NOT floating-point:
 *   - Same 12 standard checks on every run (across layout / color / typography
 *     / content / components dimensions)
 *   - Each check is yes/no with an explicit reason
 *   - parityScore is DERIVED as passCount / totalChecks, never LLM-arbitrary
 *   - status is BOUNDED ENUM thresholded from passCount (verified /
 *     needs_review / needs_iteration / failed)
 *
 * This matches NodeBench's established rule patterns:
 *   - .claude/rules/pipeline_operational_standard.md (10-gate boolean catalog)
 *   - .claude/rules/eval_flywheel.md (boolean evaluators, no hardcoded floors)
 *   - .claude/rules/agent_run_verdict_workflow.md (bounded enum verdicts)
 *
 * Why boolean over floating-point: lower judge variance, every failure has a
 * clear actionable reason, score is derived deterministically not LLM-arbitrary,
 * comparable across runs/models/time.
 *
 * Pattern mirrors generate-image-asset.ts: host injects renderUiKit + the
 * underlying judge call. Without injections the tool returns
 * status="unavailable" and the agent falls back to verify_ui_kit_parity.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { type CoreLogger, NOOP_LOGGER } from '../logger.js';
import type { TextEditorFsCallbacks } from './text-editor';

const VerifyParams = Type.Object({
  slug: Type.String(),
  /** Path to the source artifact image inside the design's virtual fs.
   *  Defaults to 'source.png' if the host stored a copy there. Source must be
   *  stored as a data URL string. */
  sourceImagePath: Type.Optional(Type.String()),
});

export interface VisualParityGap {
  kind: 'layout' | 'color' | 'typography' | 'spacing' | 'content' | 'component' | 'other';
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
}

export interface VisualParityCheck {
  id: string;
  dimension: 'layout' | 'color' | 'typography' | 'content' | 'components';
  question: string;
  passed: boolean;
  reason: string;
}

export type VisualParityStatus =
  | 'verified'
  | 'needs_review'
  | 'needs_iteration'
  | 'failed'
  | 'unavailable';

export interface VisualParityReport {
  parityScore: number;
  status: VisualParityStatus;
  summary: string;
  checks: VisualParityCheck[];
  passCount: number;
  failCount: number;
  totalChecks: number;
  reasoning?: string;
  gaps: VisualParityGap[];
  judgeCostUsd?: number;
  judgeLatencyMs?: number;
}

/** The 12 standard checks. Identical set across all judge runs so reports are
 *  comparable across models, runs, and time. Same as headless pipeline. */
export const STANDARD_VISUAL_PARITY_CHECKS: Array<{
  id: string;
  dimension: VisualParityCheck['dimension'];
  question: string;
}> = [
  {
    id: 'layout.column_count_match',
    dimension: 'layout',
    question: 'Does the candidate have the same number of major columns / regions as the source?',
  },
  {
    id: 'layout.region_positions_match',
    dimension: 'layout',
    question:
      'Are major regions (header / sidebar / main / right rail / footer) in the same positions as the source?',
  },
  {
    id: 'layout.hierarchy_preserved',
    dimension: 'layout',
    question: 'Is the visual hierarchy (heading > subhead > body > footer) preserved?',
  },
  {
    id: 'color.accent_color_match',
    dimension: 'color',
    question:
      'Is the primary accent color visually equivalent to the source (same hue family, similar saturation)?',
  },
  {
    id: 'color.palette_consistency_match',
    dimension: 'color',
    question:
      'Does the overall palette feel match the source (warm/cool, saturated/muted, contrast level)?',
  },
  {
    id: 'typography.font_family_match',
    dimension: 'typography',
    question:
      'Does the font family character (serif / sans / mono) match the source for each text role?',
  },
  {
    id: 'typography.heading_hierarchy_match',
    dimension: 'typography',
    question: 'Are heading weights and sizes stepped similarly (H1 vs body vs caption)?',
  },
  {
    id: 'content.text_labels_present',
    dimension: 'content',
    question:
      'Are all visible text labels from the source present in the candidate (nav items, headings, button text)?',
  },
  {
    id: 'content.all_sections_present',
    dimension: 'content',
    question:
      'Are all distinct sections from the source present in the candidate (not just one missing region)?',
  },
  {
    id: 'components.repeated_pattern_count_match',
    dimension: 'components',
    question:
      'Does the candidate have approximately the same count of repeated patterns (cards / list items / nav links) as the source?',
  },
  {
    id: 'components.component_structure_match',
    dimension: 'components',
    question:
      'Do repeated components have the same internal anatomy (header + body + footer pieces)?',
  },
  {
    id: 'components.icon_motif_match',
    dimension: 'components',
    question: 'Are icons / glyphs in the same style (line vs filled, monochrome vs colored)?',
  },
];

/** Status thresholds, deterministic from passCount / totalChecks.
 *  Mirrors agent_run_verdict_workflow.md verdict tiers. */
export function visualParityStatusFromChecks(
  passCount: number,
  totalChecks: number,
): VisualParityStatus {
  if (totalChecks === 0) return 'failed';
  const ratio = passCount / totalChecks;
  if (ratio === 1) return 'verified';
  if (ratio >= 0.85) return 'needs_review';
  if (ratio >= 0.6) return 'needs_iteration';
  return 'failed';
}

export interface VisualParityImageRef {
  dataUrl: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

export type RenderUiKitFn = (
  indexHtml: string,
  signal?: AbortSignal,
) => Promise<VisualParityImageRef>;

/** The host-injected judge call. Returns the boolean per-check answers; this
 *  tool normalizes/derives parityScore + status deterministically. */
export type JudgeVisualParityFn = (
  source: VisualParityImageRef,
  candidate: VisualParityImageRef,
  signal?: AbortSignal,
) => Promise<{
  reasoning?: string;
  checks: Array<{ id: string; passed: boolean; reason: string }>;
  summary: string;
  gaps?: VisualParityGap[];
  costUsd: number;
}>;

function unavailableReport(reason: string): VisualParityReport {
  return {
    parityScore: 0,
    status: 'unavailable',
    summary: `Visual parity judge unavailable: ${reason}. Fall back to verify_ui_kit_parity (deterministic).`,
    checks: [],
    passCount: 0,
    failCount: 0,
    totalChecks: 0,
    gaps: [
      {
        kind: 'other',
        severity: 'low',
        description: reason,
        suggestion:
          'Ensure the host injected judgeVisualParity + renderUiKit callbacks (same pattern as generate_image_asset).',
      },
    ],
  };
}

function normalizeChecks(
  reported: Array<{ id: string; passed: boolean; reason: string }>,
): VisualParityCheck[] {
  const reportedById = new Map<string, { passed: boolean; reason: string }>();
  for (const c of reported) {
    if (c?.id && typeof c.id === 'string') {
      reportedById.set(c.id, { passed: c.passed === true, reason: c.reason ?? '(no reason)' });
    }
  }
  // Always emit ALL standard checks in canonical order. Missing checks default
  // to failed with explicit "judge did not answer" — failure-of-judge counts as
  // failure-of-parity (HONEST_SCORES rule from agentic_reliability.md).
  return STANDARD_VISUAL_PARITY_CHECKS.map((std) => {
    const r = reportedById.get(std.id);
    return {
      id: std.id,
      dimension: std.dimension,
      question: std.question,
      passed: r?.passed ?? false,
      reason: r?.reason ?? '(judge did not answer this check)',
    };
  });
}

function parseMediaType(dataUrl: string): VisualParityImageRef['mediaType'] {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif))/);
  return (m?.[1] as VisualParityImageRef['mediaType']) ?? 'image/png';
}

export function makeVerifyUiKitVisualParityTool(
  fs: TextEditorFsCallbacks | undefined,
  renderUiKit: RenderUiKitFn | undefined,
  judgeVisualParity: JudgeVisualParityFn | undefined,
  logger: CoreLogger = NOOP_LOGGER,
): AgentTool<typeof VerifyParams, VisualParityReport> {
  return {
    name: 'verify_ui_kit_visual_parity',
    label: 'Verify UI Kit visual parity',
    description:
      'Render the decomposed ui_kits/<slug>/index.html in a hidden window, take ' +
      'a screenshot, and ask a multimodal model 12 boolean parity questions ' +
      '(across layout / color / typography / content / components dimensions). ' +
      'Each question is yes/no with a clear reason. parityScore = passCount / 12 ' +
      '(derived deterministically). Status is bounded enum (verified / ' +
      'needs_review / needs_iteration / failed). Call this AFTER decompose_to_ui_kit ' +
      'and AFTER verify_ui_kit_parity (deterministic). If any check fails, re-call ' +
      'decompose_to_ui_kit addressing the failed-check reasons. If this tool ' +
      'returns status="unavailable", proceed with the deterministic verifier alone.',
    parameters: VerifyParams,
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<VisualParityReport>> {
      const startedAt = Date.now();
      const decomposedPath = `ui_kits/${params.slug}/index.html`;

      if (!fs) {
        const report = unavailableReport('virtual fs not provided');
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }
      if (!renderUiKit) {
        const report = unavailableReport('host has not injected renderUiKit callback');
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }
      if (!judgeVisualParity) {
        const report = unavailableReport('host has not injected judgeVisualParity callback');
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }

      const decomposed = fs.view(decomposedPath);
      if (!decomposed) {
        const report = {
          ...unavailableReport(`missing artifact: ${decomposedPath}`),
          status: 'needs_iteration' as const,
        };
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }

      const sourcePath = params.sourceImagePath ?? 'source.png';
      const sourceFile = fs.view(sourcePath);
      if (!sourceFile) {
        const report = unavailableReport(
          `source image not found at ${sourcePath} — agent must persist source.png before calling`,
        );
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }
      if (!sourceFile.content.startsWith('data:')) {
        const report = unavailableReport(
          `source image at ${sourcePath} must be a data URL (got prefix: ${sourceFile.content.slice(0, 40)}...)`,
        );
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }

      const sourceImg: VisualParityImageRef = {
        dataUrl: sourceFile.content,
        mediaType: parseMediaType(sourceFile.content),
      };

      // Render + judge are external best-effort calls (Playwright headless +
      // vision-LLM). If either throws (text-only model, malformed JSON,
      // headless render crash, abort), we degrade to `unavailable` instead
      // of bubbling the error and breaking the agent loop. This matches the
      // tool's documented contract — review fix #3 on PR #241.
      let candidateImg: VisualParityImageRef;
      let judgeResult: Awaited<ReturnType<typeof judgeVisualParity>>;
      try {
        logger.info('[verify_ui_kit_visual_parity] step=render', { slug: params.slug });
        candidateImg = await renderUiKit(decomposed.content, signal);
        logger.info('[verify_ui_kit_visual_parity] step=judge', { slug: params.slug });
        judgeResult = await judgeVisualParity(sourceImg, candidateImg, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.info('[verify_ui_kit_visual_parity] step=unavailable', {
          slug: params.slug,
          reason: message,
        });
        const report = unavailableReport(`render or judge failed: ${message}`);
        return { content: [{ type: 'text', text: report.summary }], details: report };
      }

      const checks = normalizeChecks(judgeResult.checks ?? []);
      const passCount = checks.filter((c) => c.passed).length;
      const failCount = checks.length - passCount;
      const totalChecks = checks.length;
      const parityScore = totalChecks === 0 ? 0 : passCount / totalChecks;
      const status = visualParityStatusFromChecks(passCount, totalChecks);
      const totalLatencyMs = Date.now() - startedAt;

      const report: VisualParityReport = {
        parityScore: Number(parityScore.toFixed(3)),
        status,
        summary: judgeResult.summary ?? 'No summary provided.',
        checks,
        passCount,
        failCount,
        totalChecks,
        ...(judgeResult.reasoning ? { reasoning: judgeResult.reasoning } : {}),
        gaps: (judgeResult.gaps ?? []).slice(0, 8),
        judgeCostUsd: judgeResult.costUsd,
        judgeLatencyMs: totalLatencyMs,
      };

      logger.info('[verify_ui_kit_visual_parity] step=ok', {
        slug: params.slug,
        parityScore: report.parityScore,
        status,
        passCount,
        failCount,
        ms: totalLatencyMs,
      });

      const summary =
        status === 'verified' || status === 'needs_review'
          ? `Visual parity ${status} (${passCount}/${totalChecks} checks passed). ${report.summary}`
          : `Visual parity ${status} (${passCount}/${totalChecks} checks passed). ${failCount} failed check(s) to address.`;

      return {
        content: [{ type: 'text', text: summary }],
        details: report,
      };
    },
  };
}
