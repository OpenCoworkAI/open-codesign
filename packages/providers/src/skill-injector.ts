import type { ChatMessage, LoadedSkill } from '@open-codesign/shared';

// ---------------------------------------------------------------------------
// Provider-agnostic skill injector
// ---------------------------------------------------------------------------

/**
 * Serialise the bodies of all enabled skills into a single block of text,
 * separated by a markdown hr so the model can distinguish skill boundaries.
 */
function buildSkillBlock(skills: LoadedSkill[]): string {
  return skills
    .map((s) => `### Skill: ${s.frontmatter.name}\n\n${s.body.trim()}`)
    .join('\n\n---\n\n');
}

function matchesProvider(providers: string[] | undefined, providerId: string): boolean {
  if (!providers || providers.length === 0) return true;
  return providers.includes('*') || providers.includes(providerId);
}

/**
 * Filter to skills that are relevant to `providerId` and not disabled.
 */
function filterActive(skills: LoadedSkill[], providerId: string): LoadedSkill[] {
  return skills.filter(
    (s) =>
      !s.frontmatter.disable_model_invocation &&
      matchesProvider(s.frontmatter.trigger?.providers, providerId),
  );
}

// Source precedence: project overrides user, user overrides builtin. Encoded
// as a numeric rank so a stable sort can place higher-priority skills first.
const SOURCE_RANK: Record<LoadedSkill['source'], number> = {
  project: 0,
  user: 1,
  builtin: 2,
};

/**
 * Sort skills into a canonical order so the injected prompt blob is purely a
 * function of the active skill set, never of how `loadSkills*` happened to
 * return them. Order: source precedence (project > user > builtin), then
 * alphabetical by frontmatter name within each source.
 *
 * Determinism here makes the concatenated body block byte-identical across
 * runs, which keeps prompt caching and snapshot tests reliable.
 */
function sortCanonical(skills: LoadedSkill[]): LoadedSkill[] {
  return [...skills].sort((a, b) => {
    const rankDelta = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (rankDelta !== 0) return rankDelta;
    return a.frontmatter.name.localeCompare(b.frontmatter.name, 'en');
  });
}

function prependSystemContent(messages: ChatMessage[], block: string): ChatMessage[] {
  const [first, ...rest] = messages;
  if (first?.role === 'system') {
    return [{ role: 'system', content: `${block}\n\n${first.content}` }, ...rest];
  }
  return [{ role: 'system', content: block }, ...messages];
}

function prependUserContent(messages: ChatMessage[], block: string): ChatMessage[] {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.role === 'user') {
      const updated: ChatMessage[] = [
        ...messages.slice(0, i),
        { role: 'user', content: `${block}\n\n${msg.content}` },
        ...messages.slice(i + 1),
      ];
      return updated;
    }
  }
  // No user message found — append as user message
  return [...messages, { role: 'user', content: block }];
}

/**
 * Inject enabled skills into a message array for a given provider.
 *
 * Scope semantics:
 * - `system`: skill block is prepended to the system prompt (or inserted as a
 *   new system message at position 0 when none exists). This is the default
 *   and works for all provider message formats handled here.
 * - `prefix`: skill block is prepended to the first user message. Useful for
 *   providers that do not accept a system role.
 *
 * Mixed-scope skill sets are split by `trigger.scope` and injected into both
 * channels independently, so each skill lands in the channel it declared. The
 * canonical sort (project > user > builtin, then alphabetical) is preserved
 * within each channel.
 *
 * The function is pure (no mutation) and returns the original array unchanged
 * when no active skills match `providerId`.
 */
export function injectSkillsIntoMessages(
  baseMessages: ChatMessage[],
  enabledSkills: LoadedSkill[],
  provider: string,
): ChatMessage[] {
  const active = sortCanonical(filterActive(enabledSkills, provider));
  if (active.length === 0) return baseMessages;

  const systemSkills = active.filter(
    (s) => (s.frontmatter.trigger?.scope ?? 'system') === 'system',
  );
  const prefixSkills = active.filter((s) => s.frontmatter.trigger?.scope === 'prefix');

  let out = baseMessages;
  if (systemSkills.length > 0) {
    out = prependSystemContent(out, buildSkillBlock(systemSkills));
  }
  if (prefixSkills.length > 0) {
    out = prependUserContent(out, buildSkillBlock(prefixSkills));
  }
  return out;
}
