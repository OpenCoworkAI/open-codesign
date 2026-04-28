/**
 * Full (pre-disclosure) composer. Returns the ordered list of section
 * bodies that make up the system prompt for a given mode.
 */
import {
  ANTI_SLOP_DIGEST,
  BRAND_ACQUISITION,
  DESIGN_METHODOLOGY,
  EDITMODE_PROTOCOL,
  IDENTITY,
  MULTI_SCREEN_BATON,
  OUTPUT_RULES,
  PRE_FLIGHT,
  SAFETY,
  TWEAKS_PROTOCOL,
  WORKFLOW,
} from './sections/loader.js';

export type PromptMode = 'create' | 'tweak' | 'revise';

export function composeFull(mode: PromptMode): string[] {
  const sections: string[] = [
    IDENTITY,
    WORKFLOW,
    OUTPUT_RULES,
    DESIGN_METHODOLOGY,
    PRE_FLIGHT,
    EDITMODE_PROTOCOL,
  ];

  if (mode === 'tweak') {
    sections.push(TWEAKS_PROTOCOL);
  }

  sections.push(ANTI_SLOP_DIGEST);
  sections.push(BRAND_ACQUISITION);
  sections.push(MULTI_SCREEN_BATON);
  sections.push(SAFETY);
  return sections;
}
