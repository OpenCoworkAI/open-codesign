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

// ---------------------------------------------------------------------------
// Skill matching against a free-form user prompt
// ---------------------------------------------------------------------------

/**
 * Trigger keyword groups. Each group is a bag of synonyms — English vocabulary
 * that appears in builtin skill descriptions plus Chinese aliases that appear
 * in user prompts. Matching is by group-id intersection (not literal string
 * equality), so a Chinese prompt like "数据看板" can resolve to the same bucket
 * as an English description like "dashboards, analytics".
 *
 * Each group splits its vocabulary into `strong` and `weak`:
 *  - `strong` tokens fire the group on their own.
 *  - `weak` tokens only count when a `strong` from the same group co-occurs in
 *    the same text. They exist to suppress broad Chinese aliases (分析 / 应用 /
 *    演示) that would otherwise over-trigger via plain substring match — e.g.
 *    "分析这段文本" matching dashboard, "Web 应用" matching mobile-mock,
 *    "演示一下功能" matching deck.
 *
 * Add new entries to an existing group when extending vocabulary for the same
 * concept; add a new group only when introducing a skill whose intent isn't
 * covered by an existing concept.
 *
 * Excluded on purpose: "design" / "设计" — appears in nearly every prompt and
 * would force-match every skill on every call.
 *
 * Note on bare 'app': accepted false-positive risk (matches "apple",
 * "application"). Kept in `strong` because it is the highest-frequency bridge
 * between Chinese prompts ("做个 App") and the mobile-mock description
 * ("app screen").
 */
type TriggerGroup = { strong: readonly string[]; weak: readonly string[] };

const SKILL_TRIGGER_GROUPS: readonly TriggerGroup[] = [
  // dashboard / data
  {
    strong: [
      'dashboard',
      'chart',
      'graph',
      'analytics',
      'kpi',
      'metric',
      'data viz',
      'data-driven',
      'recharts',
      '仪表盘',
      '看板',
      '数据看板',
      '数据图',
      '图表',
      '数据',
      '统计',
    ],
    weak: ['分析'],
  },
  // landing / web
  {
    strong: [
      'landing',
      'homepage',
      'hero',
      'web page',
      'website',
      '落地页',
      '官网',
      '首页',
      '主页',
      '网页',
      '宣传页',
    ],
    weak: [],
  },
  // mobile / app — kept strictly mobile-specific. Generic words like 'prototype'
  // and '原型' do NOT belong here: bucketing them into mobile false-fires
  // mobile-mock for "landing page prototype" / "落地页的原型". They also can't
  // safely live in UI-broad, because mobile-mock's own description hits UI-broad
  // via 'screen', so the cross-bucket intersection would still false-fire.
  // The mobile-mock description still lands in this bucket via mobile/app/phone,
  // so dropping the generic prototype tokens costs no recall on real mobile prompts.
  {
    strong: [
      'mobile',
      'phone',
      'app screen',
      'app',
      'ios',
      'iphone',
      'android',
      '移动端',
      '移动应用',
      '手机',
      'app设计',
    ],
    weak: ['应用'],
  },
  // slides / deck
  {
    strong: [
      'deck',
      'slide',
      'slides',
      'presentation',
      'pitch',
      'keynote',
      '幻灯片',
      '演示文稿',
      'ppt',
      '路演',
      '提案',
    ],
    weak: ['演示'],
  },
  // UI broad
  {
    strong: ['ui', 'interface', 'screen', '界面', '原型图', '设计稿'],
    weak: [],
  },
] as const;

// A group fires when any `strong` token is present. `weak` tokens never fire
// alone — they were demoted from strong because their substring match
// over-triggered in unrelated prompts (e.g. 应用 hitting "Web 应用",
// 演示 hitting "演示一下功能"). When a strong from the same group is also
// present the weak token is considered, but that's already covered by the
// strong hit, so the rule collapses to: strong-only firing.
function extractGroupIds(text: string): Set<number> {
  const lower = text.toLowerCase();
  const hits = new Set<number>();
  for (let i = 0; i < SKILL_TRIGGER_GROUPS.length; i++) {
    const group = SKILL_TRIGGER_GROUPS[i];
    if (!group) continue;
    for (const kw of group.strong) {
      if (lower.includes(kw)) {
        hits.add(i);
        break;
      }
    }
  }
  return hits;
}

/**
 * Pick the subset of `skills` whose description shares at least one trigger
 * concept group with `userPrompt`. Pure function, no provider call, no
 * allocation per skill beyond the Set lookup. Returns an empty array when the
 * prompt has no triggering vocabulary.
 */
export function matchSkillsToPrompt(skills: LoadedSkill[], userPrompt: string): LoadedSkill[] {
  if (!userPrompt.trim()) return [];
  const promptGroups = extractGroupIds(userPrompt);
  if (promptGroups.size === 0) return [];

  return skills.filter((s) => {
    const descGroups = extractGroupIds(s.frontmatter.description);
    for (const id of descGroups) {
      if (promptGroups.has(id)) return true;
    }
    return false;
  });
}
