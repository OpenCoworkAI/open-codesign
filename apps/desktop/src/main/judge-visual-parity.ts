/**
 * judge-visual-parity.ts — host-side vision judge for the
 * verify_ui_kit_visual_parity agent tool.
 *
 * Receives source + candidate images and asks a vision-capable model 12
 * standard boolean parity checks. Doesn't reimplement config resolution —
 * the caller injects a `runVisionPrompt` callback that does the actual LLM
 * call (using whatever model/apiKey/baseUrl the host already has wired for
 * the active generation request). Keeps this module decoupled from cfg
 * plumbing.
 */

import type { JudgeVisualParityFn, VisualParityImageRef } from '@open-codesign/core';

const STANDARD_CHECKS: Array<{ id: string; question: string }> = [
  {
    id: 'layout.column_count_match',
    question: 'Does the candidate have the same number of major columns / regions as the source?',
  },
  {
    id: 'layout.region_positions_match',
    question:
      'Are major regions (header / sidebar / main / right rail / footer) in the same positions as the source?',
  },
  {
    id: 'layout.hierarchy_preserved',
    question: 'Is the visual hierarchy (heading > subhead > body > footer) preserved?',
  },
  {
    id: 'color.accent_color_match',
    question:
      'Is the primary accent color visually equivalent to the source (same hue family, similar saturation)?',
  },
  {
    id: 'color.palette_consistency_match',
    question:
      'Does the overall palette feel match the source (warm/cool, saturated/muted, contrast level)?',
  },
  {
    id: 'typography.font_family_match',
    question:
      'Does the font family character (serif / sans / mono) match the source for each text role?',
  },
  {
    id: 'typography.heading_hierarchy_match',
    question: 'Are heading weights and sizes stepped similarly (H1 vs body vs caption)?',
  },
  {
    id: 'content.text_labels_present',
    question:
      'Are all visible text labels from the source present in the candidate (nav items, headings, button text)?',
  },
  {
    id: 'content.all_sections_present',
    question:
      'Are all distinct sections from the source present in the candidate (not just one missing region)?',
  },
  {
    id: 'components.repeated_pattern_count_match',
    question:
      'Does the candidate have approximately the same count of repeated patterns (cards / list items / nav links) as the source?',
  },
  {
    id: 'components.component_structure_match',
    question:
      'Do repeated components have the same internal anatomy (header + body + footer pieces)?',
  },
  {
    id: 'components.icon_motif_match',
    question: 'Are icons / glyphs in the same style (line vs filled, monochrome vs colored)?',
  },
];

export const SYSTEM_PROMPT = `You are a meticulous visual QA judge comparing two UI screenshots.

Image 1 = SOURCE (the design that should be matched)
Image 2 = CANDIDATE (the rendered HTML the agent produced)

You answer ${STANDARD_CHECKS.length} BOOLEAN parity questions, each with an explicit reason. You do NOT emit floating-point scores — the aggregate parityScore is derived deterministically by the caller from passed/total.

THE 12 CHECKS:
${STANDARD_CHECKS.map((c, i) => `  ${i + 1}. id="${c.id}": ${c.question}`).join('\n')}

PROCESS:
  1. Look at both images carefully
  2. Write 1-3 short sentences of overall reasoning
  3. For EACH of the 12 checks, answer passed (true/false) with a 1-sentence reason
  4. List actionable gaps from failed checks (max 8) — kind, severity, description, suggestion
  5. Write a 1-2 sentence summary

CALIBRATION FOR "passed":
  - true   = the candidate clearly satisfies the question; minor cosmetic difference is fine
  - false  = the candidate clearly fails OR critical detail is wrong/missing
  - On close calls, lean false (false negatives drive iteration; false positives waste cost)

Output ONLY a JSON object, no markdown fences:
{
  "reasoning": "Source shows X. Candidate shows Y. Main differences are Z.",
  "checks": [
    { "id": "layout.column_count_match", "passed": true, "reason": "Both show 3 main columns." },
    ... (all 12 in order)
  ],
  "summary": "1-2 sentence overall verdict.",
  "gaps": [
    { "kind": "color"|"layout"|"typography"|"spacing"|"content"|"component"|"other", "severity": "high"|"medium"|"low", "description": "...", "suggestion": "..." }
  ]
}`;

export const USER_PROMPT =
  'Image 1 is the SOURCE (target design). Image 2 is the CANDIDATE (rendered HTML the agent produced). ' +
  'Answer all 12 boolean parity checks with a clear reason for each. Output JSON only.';

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf('base64,');
  if (idx === -1) throw new Error('Image must be a base64 data URL');
  return dataUrl.slice(idx + 'base64,'.length);
}

export interface VisionPromptInput {
  systemPrompt: string;
  userText: string;
  userImages: Array<{ data: string; mimeType: string }>;
  maxTokens: number;
  signal?: AbortSignal | undefined;
}

export interface VisionPromptResult {
  content: string;
  costUsd: number;
}

/**
 * Host wires this with its existing provider plumbing — the judge doesn't
 * know about cfg / model resolution / api keys.
 */
export type RunVisionPromptFn = (input: VisionPromptInput) => Promise<VisionPromptResult>;

export function makeJudgeVisualParity(runVisionPrompt: RunVisionPromptFn): JudgeVisualParityFn {
  return async (
    source: VisualParityImageRef,
    candidate: VisualParityImageRef,
    signal?: AbortSignal,
  ) => {
    const userImages = [
      { data: dataUrlToBase64(source.dataUrl), mimeType: source.mediaType },
      { data: dataUrlToBase64(candidate.dataUrl), mimeType: candidate.mediaType },
    ];

    const result = await runVisionPrompt({
      systemPrompt: SYSTEM_PROMPT,
      userText: USER_PROMPT,
      userImages,
      maxTokens: 8000,
      ...(signal ? { signal } : {}),
    });

    const cleaned = stripCodeFences(result.content);
    if (!cleaned) throw new Error('Vision judge returned empty content.');
    const extracted = extractFirstJsonObject(cleaned);

    let parsed: {
      reasoning?: string;
      checks?: Array<{ id?: string; passed?: unknown; reason?: string }>;
      summary?: string;
      gaps?: Array<{ kind?: string; severity?: string; description?: string; suggestion?: string }>;
    };
    try {
      parsed = JSON.parse(extracted);
    } catch (err) {
      throw new Error(
        `Vision judge returned non-JSON: ${(err as Error).message}. First 500 chars:\n${cleaned.slice(0, 500)}`,
      );
    }

    const checks = (parsed.checks ?? [])
      .map((c) => ({
        id: typeof c.id === 'string' ? c.id : '',
        passed: c.passed === true || c.passed === 'true',
        reason: typeof c.reason === 'string' ? c.reason : '(no reason given)',
      }))
      .filter((c) => c.id);

    const gaps = (parsed.gaps ?? [])
      .map((g) => ({
        kind: (g.kind ?? 'other') as
          | 'layout'
          | 'color'
          | 'typography'
          | 'spacing'
          | 'content'
          | 'component'
          | 'other',
        severity: (g.severity ?? 'medium') as 'high' | 'medium' | 'low',
        description: g.description ?? '',
        suggestion: g.suggestion ?? '',
      }))
      .slice(0, 8);

    return {
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      checks,
      summary: parsed.summary ?? 'No summary provided.',
      gaps,
      costUsd: result.costUsd,
    };
  };
}
