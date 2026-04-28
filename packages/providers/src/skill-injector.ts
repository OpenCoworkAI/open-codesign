import type { LoadedSkill } from '@open-codesign/shared';

// ---------------------------------------------------------------------------
// Provider-agnostic skill manifest helpers.
//
// v0.2 does not inject full skill bodies into request prompts. Core builds a
// compact resource manifest from active skill metadata, and the `skill(name)`
// tool is the only path that returns full markdown to the agent.
// ---------------------------------------------------------------------------

function matchesProvider(providers: string[] | undefined, providerId: string): boolean {
  if (!providers || providers.length === 0) return true;
  return providers.includes('*') || providers.includes(providerId);
}

/**
 * Filter to skills that are relevant to `providerId` and not disabled.
 */
export function filterActive(skills: LoadedSkill[], providerId: string): LoadedSkill[] {
  return skills.filter(
    (s) =>
      !s.frontmatter.disable_model_invocation &&
      matchesProvider(s.frontmatter.trigger?.providers, providerId),
  );
}
