/**
 * Full (pre-disclosure) composer. Returns the ordered list of section
 * bodies that make up the system prompt for a given mode.
 */
import type { SourceIdentityV1 } from '@open-codesign/shared';
import { authoringProfileFor } from '../authoring-profile.js';
import {
  ANTI_SLOP_DIGEST,
  BRAND_ACQUISITION,
  DESIGN_METHODOLOGY,
  EDITMODE_PROTOCOL,
  IDENTITY,
  MULTI_SCREEN_BATON,
  NATIVE_EDITMODE_PROTOCOL,
  NATIVE_OUTPUT_RULES,
  NATIVE_PRE_FLIGHT,
  NATIVE_TWEAKS_PROTOCOL,
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

function describeSetting(name: string, value: PromptFeatureSetting): string {
  const reason = value.reason ? ` — ${value.reason}` : '';
  return `- ${name}: ${value.mode} (${value.provenance}, ${value.confidence})${reason}`;
}

function featureRoutingSection(
  profile: PromptFeatureProfile | undefined,
  native: boolean,
): string | null {
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
    lines.push(
      'The user explicitly declined EDITMODE tweak controls. Do not create controls or call `tweaks()` this turn.',
    );
  } else if (tweaks.mode === 'disabled') {
    lines.push(
      'Tweak controls look unnecessary from context; this is a soft preference, not a prohibition.',
    );
  } else if (tweaks.mode === 'enabled') {
    lines.push(
      native
        ? 'Expose useful source-backed EDITMODE declarations after the main behavior works. Implement authored bindings and CSS fallbacks; `tweaks()` discovers declarations without promising host-panel synchronization.'
        : 'Expose useful source-backed EDITMODE decisions after the main behavior works, then call `tweaks()` when available.',
    );
  } else {
    lines.push('Use tweak controls only when they materially improve iteration.');
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

export function composeFull(
  mode: PromptMode,
  featureProfile?: PromptFeatureProfile,
  source?: SourceIdentityV1,
): string[] {
  const native = authoringProfileFor(source) === 'native-html';
  const sections: string[] = [
    IDENTITY,
    WORKFLOW,
    native ? NATIVE_OUTPUT_RULES : OUTPUT_RULES,
    DESIGN_METHODOLOGY,
    native ? NATIVE_PRE_FLIGHT : PRE_FLIGHT,
    native ? NATIVE_EDITMODE_PROTOCOL : EDITMODE_PROTOCOL,
  ];
  if (native && source)
    sections.push(
      `Primary native HTML source: ${JSON.stringify(source.path)}. Read, edit, preview, and finish this exact path; resources cannot change this identity.`,
    );

  if (mode === 'tweak') {
    sections.push(native ? NATIVE_TWEAKS_PROTOCOL : TWEAKS_PROTOCOL);
  }

  sections.push(ANTI_SLOP_DIGEST);
  sections.push(BRAND_ACQUISITION);
  sections.push(MULTI_SCREEN_BATON);
  const routing = featureRoutingSection(featureProfile, native);
  if (routing) sections.push(routing);
  sections.push(SAFETY);
  return sections;
}
