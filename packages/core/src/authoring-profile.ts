import type { SourceIdentityV1 } from '@open-codesign/shared';

export function authoringProfileFor(source?: SourceIdentityV1): 'legacy' | 'native-html' {
  return source?.runtimeMode === 'native-html' ? 'native-html' : 'legacy';
}

const nativeScaffolds = new Set([
  'terminal',
  'slide-16-9-deck',
  'executive-brief-report',
  'aurora-mesh-bg',
  'glassmorphism-bg',
  'bento-grid-bg',
  'noise-grain-bg',
  'dot-grid-bg',
  'animated-gradient-bg',
  'neubrutalism-surface',
  'design-system-starter',
]);
const nativeSkills = new Set([
  'cjk-typography',
  'empty-states',
  'form-layout',
  'loading-skeleton',
  'pitch-deck',
  'surface-elevation',
  'chart-rendering',
  'responsive-layout',
  'design-reference-to-html',
  'accessibility-states',
  'app-shell-navigation',
  'artifact-composition',
  'craft-polish',
  'design-system-baton',
  'frontend-design-anti-slop',
  'mobile-mock',
]);
const nativeOverlays = new Set(['design-reference-to-html', 'craft-polish', 'chart-rendering']);

export function isAuthoringResourceEligible(
  category: 'skill' | 'scaffold' | 'brand-ref',
  name: string,
  source?: SourceIdentityV1,
): boolean {
  if (authoringProfileFor(source) === 'legacy' || category === 'brand-ref') return true;
  return (category === 'skill' ? nativeSkills : nativeScaffolds).has(name);
}

export function nativeSkillPath(id: string, source?: SourceIdentityV1): string {
  return authoringProfileFor(source) === 'native-html' && nativeOverlays.has(id)
    ? `native-html/${id}.md`
    : `${id}.md`;
}
