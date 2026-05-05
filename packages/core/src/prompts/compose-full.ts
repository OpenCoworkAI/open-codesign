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
export type PromptFeatureMode = 'enabled' | 'disabled' | 'auto';
export type PromptFeatureProvenance = 'explicit' | 'inferred' | 'default';
export type PromptFeatureConfidence = 'high' | 'medium' | 'low';

export interface PromptFeatureSetting {
  mode: PromptFeatureMode;
  provenance: PromptFeatureProvenance;
  confidence: PromptFeatureConfidence;
  reason?: string | undefined;
}

export interface PromptFeatureProfile {
  tweaks: PromptFeatureMode | PromptFeatureSetting;
  bitmapAssets: PromptFeatureMode | PromptFeatureSetting;
  reusableSystem: PromptFeatureMode | PromptFeatureSetting;
  visualDirection?: string | undefined;
}

function setting(value: PromptFeatureMode | PromptFeatureSetting): PromptFeatureSetting {
  if (typeof value === 'string') return { mode: value, provenance: 'default', confidence: 'low' };
  return value;
}

function featureMode(value: PromptFeatureMode | PromptFeatureSetting): PromptFeatureMode {
  return setting(value).mode;
}

function describeSetting(name: string, value: PromptFeatureSetting): string {
  const reason = value.reason ? ` — ${value.reason}` : '';
  return `- ${name}: ${value.mode} (${value.provenance}, ${value.confidence})${reason}`;
}

function workflowForFeatures(profile: PromptFeatureProfile | undefined): string {
  if (profile !== undefined && featureMode(profile.tweaks) === 'disabled') {
    return WORKFLOW.replace(
      '8. **Expose tweaks selectively** — call `tweaks()` only when the user asked for controls, answered that controls would help, or the artifact has 2-5 obvious high-leverage values. Skip tweak work for narrow edits, throwaway sketches, or when the user declines; they can ask for controls in a later turn.',
      '8. **Skip tweaks** — Do not create EDITMODE tweak controls or call `tweaks()` in this turn. The user can ask for controls in a later turn.',
    );
  }
  if (profile !== undefined && featureMode(profile.tweaks) === 'enabled') {
    return WORKFLOW.replace(
      '8. **Expose tweaks selectively** — call `tweaks()` only when the user asked for controls, answered that controls would help, or the artifact has 2-5 obvious high-leverage values. Skip tweak work for narrow edits, throwaway sketches, or when the user declines; they can ask for controls in a later turn.',
      '8. **Expose tweaks** — Create 2-5 high-leverage EDITMODE controls and call `tweaks()` after the first complete pass.',
    );
  }
  return WORKFLOW;
}

function featureRoutingSection(profile: PromptFeatureProfile | undefined): string | null {
  if (!profile) return null;
  const lines = ['# User-routed preferences', ''];
  const tweaks = setting(profile.tweaks);
  const bitmapAssets = setting(profile.bitmapAssets);
  const reusableSystem = setting(profile.reusableSystem);
  lines.push(describeSetting('tweaks', tweaks));
  lines.push(describeSetting('bitmapAssets', bitmapAssets));
  lines.push(describeSetting('reusableSystem', reusableSystem));
  lines.push('');
  if (tweaks.mode === 'disabled' && tweaks.provenance === 'explicit') {
    lines.push('The user explicitly declined EDITMODE tweak controls for this run.');
  } else if (tweaks.mode === 'disabled') {
    lines.push(
      'Tweak controls look unnecessary from context; keep them available only if they clearly help.',
    );
  } else if (tweaks.mode === 'enabled') {
    lines.push(
      'Create 2-5 high-leverage EDITMODE controls for the artifact and call `tweaks()` before `done(path)`.',
    );
  } else {
    lines.push('When available, decide agentically whether tweak controls improve iteration.');
  }
  if (bitmapAssets.mode === 'disabled' && bitmapAssets.provenance === 'explicit') {
    lines.push('The user explicitly declined generated bitmap assets for this run.');
  } else if (bitmapAssets.mode === 'disabled') {
    lines.push(
      'Bitmap asset generation looks unnecessary from context; keep it as a soft preference unless the user explicitly declined.',
    );
  } else if (bitmapAssets.mode === 'enabled') {
    lines.push('Use generated bitmap assets when they materially improve the design.');
  }
  if (reusableSystem.mode === 'enabled') {
    lines.push(
      'Treat this as reusable system work: maintain `DESIGN.md` and stable tokens/components.',
    );
  }
  if (profile.visualDirection) {
    lines.push(`Preferred visual direction: ${profile.visualDirection}.`);
  }
  return lines.join('\n');
}

export function composeFull(mode: PromptMode, featureProfile?: PromptFeatureProfile): string[] {
  const sections: string[] = [
    IDENTITY,
    workflowForFeatures(featureProfile),
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
  const routing = featureRoutingSection(featureProfile);
  if (routing) sections.push(routing);
  sections.push(SAFETY);
  return sections;
}
