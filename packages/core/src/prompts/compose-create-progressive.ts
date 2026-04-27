/**
 * Progressive-disclosure composer for `create` mode with a user prompt.
 *
 * The full prompt is ~44 KB / 11k tokens and crushes small-context models.
 * We split it into:
 *   - Layer 1 (always, ~12 KB): identity, workflow, output-rules,
 *     design-methodology, pre-flight, editmode-protocol, safety,
 *     anti-slop-digest, device-frames-hint.
 *   - Layer 2 (keyword-matched): chart-rendering, ios-starter-template,
 *     and individual craft-directives subsections triggered by dashboard /
 *     mobile / marketing / logo cues. If no keyword matches, use
 *     the full craft-directives section.
 *
 * Layer 3 — retry-on-quality-fail injection of full ANTI_SLOP +
 * ARTIFACT_TYPES — is deferred.
 * TODO(progressive-prompt-v2): wire this into the generate retry loop.
 */
import { buildCraftBlock } from './craft-block.js';
import { planKeywordMatches } from './plan-keywords.js';
import {
  ANTI_SLOP_DIGEST,
  CRAFT_DIRECTIVES,
  DESIGN_METHODOLOGY,
  DEVICE_FRAMES_HINT,
  EDITMODE_PROTOCOL,
  IDENTITY,
  OUTPUT_RULES,
  PRE_FLIGHT,
  SAFETY,
  WORKFLOW,
} from './sections/loader.js';

const LAYER_1_BASE: readonly string[] = [
  IDENTITY,
  WORKFLOW,
  OUTPUT_RULES,
  DESIGN_METHODOLOGY,
  PRE_FLIGHT,
  EDITMODE_PROTOCOL,
  SAFETY,
  ANTI_SLOP_DIGEST,
  DEVICE_FRAMES_HINT,
];

export function composeCreateProgressive(userPrompt: string): string[] {
  const sections: string[] = [...LAYER_1_BASE];
  const plan = planKeywordMatches(userPrompt);
  const noMatch = plan.topLevel.length === 0 && plan.craftSubsectionNames.length === 0;

  if (noMatch) {
    sections.push(CRAFT_DIRECTIVES);
    return sections;
  }

  sections.push(...plan.topLevel);
  const craftBlock = buildCraftBlock(plan.craftSubsectionNames);
  if (craftBlock) sections.push(craftBlock);
  return sections;
}
