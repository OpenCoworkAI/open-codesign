/**
 * Full (pre-disclosure) composer. Returns the ordered list of section
 * bodies that make up the system prompt for a given mode.
 */
import {
  ANTI_SLOP,
  ARTIFACT_TYPES,
  BRAND_ACQUISITION,
  CHART_RENDERING,
  CRAFT_DIRECTIVES,
  DESIGN_METHODOLOGY,
  DEVICE_FRAMES_HINT,
  EDITMODE_PROTOCOL,
  IDENTITY,
  IOS_STARTER_TEMPLATE,
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
    ARTIFACT_TYPES,
    PRE_FLIGHT,
    EDITMODE_PROTOCOL,
  ];

  if (mode === 'tweak') {
    sections.push(TWEAKS_PROTOCOL);
  }

  if (mode !== 'tweak') {
    sections.push(CRAFT_DIRECTIVES);
    sections.push(CHART_RENDERING);
  }
  if (mode === 'create') {
    sections.push(IOS_STARTER_TEMPLATE);
    sections.push(DEVICE_FRAMES_HINT);
  }
  sections.push(ANTI_SLOP);
  sections.push(BRAND_ACQUISITION);
  sections.push(MULTI_SCREEN_BATON);
  sections.push(SAFETY);
  return sections;
}
