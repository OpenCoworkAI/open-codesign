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
 * Priority order is assumed to already be encoded in the `skills` array
 * by the loader (project > user > builtin).
 */
function filterActive(skills: LoadedSkill[], providerId: string): LoadedSkill[] {
  return skills.filter(
    (s) =>
      !s.frontmatter.disable_model_invocation &&
      matchesProvider(s.frontmatter.trigger?.providers, providerId),
  );
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
 * The function is pure (no mutation) and returns the original array unchanged
 * when no active skills match `providerId`.
 */
export function injectSkillsIntoMessages(
  baseMessages: ChatMessage[],
  enabledSkills: LoadedSkill[],
  provider: string,
): ChatMessage[] {
  const active = filterActive(enabledSkills, provider);
  if (active.length === 0) return baseMessages;

  const block = buildSkillBlock(active);

  // Use the scope of the first active skill as the injection strategy.
  // All skills in a single generation share one scope; mixing scopes is not
  // supported — the system setting wins.
  const scope = active[0]?.frontmatter.trigger?.scope ?? 'system';

  if (scope === 'prefix') {
    return prependUserContent(baseMessages, block);
  }

  return prependSystemContent(baseMessages, block);
}
