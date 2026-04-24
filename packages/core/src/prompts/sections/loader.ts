/**
 * Loads prompt section text from sibling `.md` files at module init.
 *
 * Each section lives as its own `.md` file so PR diffs and git blame read
 * cleanly. Files are read once at module-load time and exposed as frozen
 * string constants. Trailing `\n` (from editors adding final newline) is
 * stripped so the loaded value matches what a TS template literal would
 * produce.
 *
 * Path resolution uses `import.meta.url` — this file must stay colocated
 * with the `.md` files it loads.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function load(name: string): string {
  const raw = readFileSync(path.join(here, `${name}.md`), 'utf-8');
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

export const IDENTITY = load('identity');
export const WORKFLOW = load('workflow');
export const OUTPUT_RULES = load('output-rules');
export const DESIGN_METHODOLOGY = load('design-methodology');
export const ARTIFACT_TYPES = load('artifact-types');
export const PRE_FLIGHT = load('pre-flight');
export const EDITMODE_PROTOCOL = load('editmode-protocol');
export const TWEAKS_PROTOCOL = load('tweaks-protocol');
export const CRAFT_DIRECTIVES = load('craft-directives');
export const CHART_RENDERING = load('chart-rendering');
export const IOS_STARTER_TEMPLATE = load('ios-starter-template');
export const DEVICE_FRAMES_HINT = load('device-frames-hint');
export const ANTI_SLOP = load('anti-slop');
export const ANTI_SLOP_DIGEST = load('anti-slop-digest');
export const MARKETING_FONT_HINT = load('marketing-font-hint');
export const SAFETY = load('safety');
export const BRAND_ACQUISITION = load('brand-acquisition');
export const MULTI_SCREEN_BATON = load('multi-screen-baton');

export const PROMPT_SECTIONS: Record<string, string> = {
  identity: IDENTITY,
  workflow: WORKFLOW,
  outputRules: OUTPUT_RULES,
  designMethodology: DESIGN_METHODOLOGY,
  artifactTypes: ARTIFACT_TYPES,
  preFlight: PRE_FLIGHT,
  editmodeProtocol: EDITMODE_PROTOCOL,
  tweaksProtocol: TWEAKS_PROTOCOL,
  craftDirectives: CRAFT_DIRECTIVES,
  chartRendering: CHART_RENDERING,
  iosStarterTemplate: IOS_STARTER_TEMPLATE,
  deviceFramesHint: DEVICE_FRAMES_HINT,
  antiSlop: ANTI_SLOP,
  antiSlopDigest: ANTI_SLOP_DIGEST,
  marketingFontHint: MARKETING_FONT_HINT,
  safety: SAFETY,
  brandAcquisition: BRAND_ACQUISITION,
  multiScreenBaton: MULTI_SCREEN_BATON,
};

export const PROMPT_SECTION_FILES: Record<keyof typeof PROMPT_SECTIONS, string> = {
  identity: 'sections/identity.md',
  workflow: 'sections/workflow.md',
  outputRules: 'sections/output-rules.md',
  designMethodology: 'sections/design-methodology.md',
  artifactTypes: 'sections/artifact-types.md',
  preFlight: 'sections/pre-flight.md',
  editmodeProtocol: 'sections/editmode-protocol.md',
  tweaksProtocol: 'sections/tweaks-protocol.md',
  craftDirectives: 'sections/craft-directives.md',
  chartRendering: 'sections/chart-rendering.md',
  iosStarterTemplate: 'sections/ios-starter-template.md',
  deviceFramesHint: 'sections/device-frames-hint.md',
  antiSlop: 'sections/anti-slop.md',
  antiSlopDigest: 'sections/anti-slop-digest.md',
  marketingFontHint: 'sections/marketing-font-hint.md',
  safety: 'sections/safety.md',
  brandAcquisition: 'sections/brand-acquisition.md',
  multiScreenBaton: 'sections/multi-screen-baton.md',
};
