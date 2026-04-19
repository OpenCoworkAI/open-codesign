import type { ChatMessage, LoadedSkill } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { injectSkillsIntoMessages, matchSkillsToPrompt } from './skill-injector.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSkill(id: string, overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    id,
    source: 'builtin',
    frontmatter: {
      schemaVersion: 1,
      name: id,
      description: `Description for ${id}.`,
      trigger: { providers: ['*'], scope: 'system' },
      disable_model_invocation: false,
      user_invocable: true,
    },
    body: `Body of ${id}.`,
    ...overrides,
  };
}

const BASE_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Design a landing page.' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('injectSkillsIntoMessages()', () => {
  it('returns original array unchanged when no skills provided', () => {
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [], 'anthropic');
    expect(result).toBe(BASE_MESSAGES);
  });

  it('returns original array when all skills are disabled', () => {
    const disabled = makeSkill('disabled', {
      frontmatter: {
        schemaVersion: 1,
        name: 'disabled',
        description: 'Disabled skill.',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: true,
        user_invocable: true,
      },
    });
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [disabled], 'anthropic');
    expect(result).toBe(BASE_MESSAGES);
  });

  it('produces exactly one extra system message when injecting into existing system message', () => {
    const skill = makeSkill('test-skill');
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [skill], 'anthropic');
    // Should still have same number of messages (prepended to existing system)
    expect(result).toHaveLength(BASE_MESSAGES.length);
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toContain('Body of test-skill.');
    expect(result[0]?.content).toContain('You are a helpful assistant.');
  });

  it('inserts a new system message when no system message exists', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Design a landing page.' }];
    const skill = makeSkill('test-skill');
    const result = injectSkillsIntoMessages(messages, [skill], 'anthropic');
    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toContain('Body of test-skill.');
    expect(result[1]?.role).toBe('user');
  });

  it('injects multiple skills into a single system message in order', () => {
    const projectSkill = makeSkill('proj', {
      source: 'project',
      body: 'Project skill body.',
    });
    const builtinSkill = makeSkill('builtin', {
      source: 'builtin',
      body: 'Builtin skill body.',
    });
    // Pass in priority order: project first, then builtin
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [projectSkill, builtinSkill], 'openai');
    expect(result[0]?.role).toBe('system');
    const content = result[0]?.content ?? '';
    const projIdx = content.indexOf('Project skill body.');
    const builtinIdx = content.indexOf('Builtin skill body.');
    expect(projIdx).toBeGreaterThanOrEqual(0);
    expect(builtinIdx).toBeGreaterThanOrEqual(0);
    // Project skill comes first (higher priority)
    expect(projIdx).toBeLessThan(builtinIdx);
  });

  it('filters skills that do not match the provider', () => {
    const anthropicOnly = makeSkill('anthropic-only', {
      frontmatter: {
        schemaVersion: 1,
        name: 'anthropic-only',
        description: 'Anthropic only.',
        trigger: { providers: ['anthropic'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
    });
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [anthropicOnly], 'openai');
    // No match → original array returned unchanged
    expect(result).toBe(BASE_MESSAGES);
  });

  it('matches wildcard provider to any provider string', () => {
    const wildcard = makeSkill('wildcard', {
      frontmatter: {
        schemaVersion: 1,
        name: 'wildcard',
        description: 'Wildcard skill.',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
    });
    const forGoogle = injectSkillsIntoMessages(BASE_MESSAGES, [wildcard], 'google');
    expect(forGoogle[0]?.content).toContain('Body of wildcard.');
    const forGroq = injectSkillsIntoMessages(BASE_MESSAGES, [wildcard], 'groq');
    expect(forGroq[0]?.content).toContain('Body of wildcard.');
  });

  it('uses prefix scope to prepend to first user message', () => {
    const prefixSkill = makeSkill('prefix-skill', {
      frontmatter: {
        schemaVersion: 1,
        name: 'prefix-skill',
        description: 'Prefix skill.',
        trigger: { providers: ['*'], scope: 'prefix' },
        disable_model_invocation: false,
        user_invocable: true,
      },
    });
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [prefixSkill], 'anthropic');
    // Message count stays the same
    expect(result).toHaveLength(BASE_MESSAGES.length);
    // System prompt is untouched
    expect(result[0]?.content).toBe('You are a helpful assistant.');
    // Skill block prepended to user message
    expect(result[1]?.role).toBe('user');
    expect(result[1]?.content).toContain('Body of prefix-skill.');
    expect(result[1]?.content).toContain('Design a landing page.');
  });

  it('does not mutate the original messages array', () => {
    const original = [
      { role: 'system' as const, content: 'System prompt.' },
      { role: 'user' as const, content: 'User message.' },
    ];
    const originalSnapshot = original.map((m) => ({ ...m }));
    injectSkillsIntoMessages(original, [makeSkill('skill')], 'anthropic');
    expect(original[0]?.content).toBe(originalSnapshot[0]?.content);
    expect(original[1]?.content).toBe(originalSnapshot[1]?.content);
  });

  it('produces a byte-identical prompt regardless of input skill order', () => {
    const skills: LoadedSkill[] = [
      makeSkill('zeta', { source: 'builtin', body: 'Zeta body.' }),
      makeSkill('alpha', { source: 'user', body: 'Alpha body.' }),
      makeSkill('mango', { source: 'project', body: 'Mango body.' }),
      makeSkill('beta', { source: 'project', body: 'Beta body.' }),
      makeSkill('gamma', { source: 'user', body: 'Gamma body.' }),
    ];

    const canonical = injectSkillsIntoMessages(BASE_MESSAGES, skills, 'anthropic');
    const canonicalContent = canonical[0]?.content ?? '';

    // Project skills (alphabetical) come first, then user, then builtin.
    const expectedOrder = ['Beta body.', 'Mango body.', 'Alpha body.', 'Gamma body.', 'Zeta body.'];
    const indices = expectedOrder.map((needle) => canonicalContent.indexOf(needle));
    expect(indices.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i - 1]).toBeLessThan(indices[i] as number);
    }

    const permutations: LoadedSkill[][] = [
      [skills[1], skills[0], skills[2], skills[4], skills[3]] as LoadedSkill[],
      [skills[4], skills[3], skills[2], skills[1], skills[0]] as LoadedSkill[],
      [skills[2], skills[4], skills[0], skills[3], skills[1]] as LoadedSkill[],
    ];
    for (const perm of permutations) {
      const result = injectSkillsIntoMessages(BASE_MESSAGES, perm, 'anthropic');
      expect(result[0]?.content).toBe(canonicalContent);
    }
  });

  it('splits mixed-scope skills into separate channels', () => {
    const projectPrefix = makeSkill('proj', {
      source: 'project',
      frontmatter: {
        schemaVersion: 1,
        name: 'proj',
        description: 'Project prefix skill.',
        trigger: { providers: ['*'], scope: 'prefix' },
        disable_model_invocation: false,
        user_invocable: true,
      },
      body: 'Project prefix body.',
    });
    const userSystem = makeSkill('user', {
      source: 'user',
      frontmatter: {
        schemaVersion: 1,
        name: 'user',
        description: 'User system skill.',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
      body: 'User system body.',
    });

    const a = injectSkillsIntoMessages(BASE_MESSAGES, [projectPrefix, userSystem], 'anthropic');
    const b = injectSkillsIntoMessages(BASE_MESSAGES, [userSystem, projectPrefix], 'anthropic');
    // Order-independent: same active skill set yields the same messages.
    expect(a).toEqual(b);

    // System-scope skill lands in the system message.
    expect(a[0]?.role).toBe('system');
    expect(a[0]?.content).toContain('User system body.');
    expect(a[0]?.content).toContain('You are a helpful assistant.');
    expect(a[0]?.content).not.toContain('Project prefix body.');

    // Prefix-scope skill lands in the user message, untouched by system block.
    expect(a[1]?.role).toBe('user');
    expect(a[1]?.content).toContain('Project prefix body.');
    expect(a[1]?.content).toContain('Design a landing page.');
    expect(a[1]?.content).not.toContain('User system body.');
  });

  it('injects three-source mixed-scope set into both channels with canonical order', () => {
    const projectSystem = makeSkill('p-sys', {
      source: 'project',
      frontmatter: {
        schemaVersion: 1,
        name: 'p-sys',
        description: 'Project system skill.',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
      body: 'Project system body.',
    });
    const userPrefix = makeSkill('u-pre', {
      source: 'user',
      frontmatter: {
        schemaVersion: 1,
        name: 'u-pre',
        description: 'User prefix skill.',
        trigger: { providers: ['*'], scope: 'prefix' },
        disable_model_invocation: false,
        user_invocable: true,
      },
      body: 'User prefix body.',
    });
    const builtinSystem = makeSkill('b-sys', {
      source: 'builtin',
      frontmatter: {
        schemaVersion: 1,
        name: 'b-sys',
        description: 'Builtin system skill.',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
      body: 'Builtin system body.',
    });
    const builtinPrefix = makeSkill('b-pre', {
      source: 'builtin',
      frontmatter: {
        schemaVersion: 1,
        name: 'b-pre',
        description: 'Builtin prefix skill.',
        trigger: { providers: ['*'], scope: 'prefix' },
        disable_model_invocation: false,
        user_invocable: true,
      },
      body: 'Builtin prefix body.',
    });

    const result = injectSkillsIntoMessages(
      BASE_MESSAGES,
      [builtinPrefix, builtinSystem, userPrefix, projectSystem],
      'anthropic',
    );

    // Same message count — both blocks merged into existing system + user.
    expect(result).toHaveLength(BASE_MESSAGES.length);

    const systemContent = result[0]?.content ?? '';
    const userContent = result[1]?.content ?? '';

    // System block contains only system-scope skills, project before builtin.
    const projSysIdx = systemContent.indexOf('Project system body.');
    const builtinSysIdx = systemContent.indexOf('Builtin system body.');
    expect(projSysIdx).toBeGreaterThanOrEqual(0);
    expect(builtinSysIdx).toBeGreaterThan(projSysIdx);
    expect(systemContent).not.toContain('User prefix body.');
    expect(systemContent).not.toContain('Builtin prefix body.');

    // Prefix block contains only prefix-scope skills, user before builtin.
    const userPreIdx = userContent.indexOf('User prefix body.');
    const builtinPreIdx = userContent.indexOf('Builtin prefix body.');
    expect(userPreIdx).toBeGreaterThanOrEqual(0);
    expect(builtinPreIdx).toBeGreaterThan(userPreIdx);
    expect(userContent).not.toContain('Project system body.');
    expect(userContent).not.toContain('Builtin system body.');
  });
});

// ---------------------------------------------------------------------------
// matchSkillsToPrompt — keyword resolution incl. Chinese aliases
// ---------------------------------------------------------------------------

describe('matchSkillsToPrompt()', () => {
  // Mirror real builtin skill descriptions so the test exercises the same
  // English vocabulary the matcher sees in production.
  const dataViz = makeSkill('data-viz-recharts', {
    frontmatter: {
      schemaVersion: 1,
      name: 'data-viz-recharts',
      description:
        'Guides data visualization design using Recharts. Use when building charts, dashboards, analytics views, or any data-driven UI.',
      trigger: { providers: ['*'], scope: 'system' },
      disable_model_invocation: false,
      user_invocable: true,
    },
  });
  const mobileMock = makeSkill('mobile-mock', {
    frontmatter: {
      schemaVersion: 1,
      name: 'mobile-mock',
      description:
        'Designs mobile UI mocks and prototypes. Use when building a mobile app screen or any prototype intended to be viewed on a phone.',
      trigger: { providers: ['*'], scope: 'system' },
      disable_model_invocation: false,
      user_invocable: true,
    },
  });
  const antiSlop = makeSkill('frontend-design-anti-slop', {
    frontmatter: {
      schemaVersion: 1,
      name: 'frontend-design-anti-slop',
      description:
        'Creates distinctive frontend interfaces. Use when building any UI component, landing page, dashboard, prototype, or styling HTML/CSS.',
      trigger: { providers: ['*'], scope: 'system' },
      disable_model_invocation: false,
      user_invocable: true,
    },
  });
  const pitchDeck = makeSkill('pitch-deck', {
    frontmatter: {
      schemaVersion: 1,
      name: 'pitch-deck',
      description:
        'Designs polished pitch deck slides and presentation layouts. Use when the user asks for a slide deck, investor pitch, or presentation.',
      trigger: { providers: ['*'], scope: 'system' },
      disable_model_invocation: false,
      user_invocable: true,
    },
  });
  const all = [dataViz, mobileMock, antiSlop, pitchDeck];

  it('returns empty when prompt has no triggering vocabulary', () => {
    expect(matchSkillsToPrompt(all, 'hello world')).toEqual([]);
  });

  it('returns empty for blank prompt', () => {
    expect(matchSkillsToPrompt(all, '   ')).toEqual([]);
  });

  it('matches English mobile prompt to mobile-mock', () => {
    const matched = matchSkillsToPrompt(all, 'Design an iOS mobile app screen');
    expect(matched.map((s) => s.id)).toContain('mobile-mock');
  });

  it('matches Chinese mobile prompt — "为冥想App设计移动端原型"', () => {
    const matched = matchSkillsToPrompt(all, '为一个名叫Calm Spaces的冥想App设计移动端原型');
    const ids = matched.map((s) => s.id);
    expect(ids).toContain('mobile-mock');
  });

  it('matches Chinese dashboard prompt — "做一个数据看板"', () => {
    const matched = matchSkillsToPrompt(all, '做一个数据看板');
    const ids = matched.map((s) => s.id);
    expect(ids).toContain('data-viz-recharts');
    expect(ids).toContain('frontend-design-anti-slop');
  });

  it('matches Chinese landing prompt — "落地页"', () => {
    const matched = matchSkillsToPrompt(all, '帮我做个落地页');
    const ids = matched.map((s) => s.id);
    expect(ids).toContain('frontend-design-anti-slop');
  });

  it('matches Chinese deck prompt — "演示文稿"', () => {
    const matched = matchSkillsToPrompt(all, '需要一份投资人演示文稿');
    expect(matched.map((s) => s.id)).toContain('pitch-deck');
  });

  it('does not match unrelated skills (deck prompt skips mobile-mock)', () => {
    const matched = matchSkillsToPrompt(all, '做一个 pitch deck');
    expect(matched.map((s) => s.id)).not.toContain('mobile-mock');
  });

  // Regression: 'prototype' / '原型' are generic — they must not bias mobile-mock.
  it('does NOT match mobile-mock for generic prototype prompt — "landing page prototype"', () => {
    const matched = matchSkillsToPrompt(all, 'landing page prototype');
    const ids = matched.map((s) => s.id);
    expect(ids).not.toContain('mobile-mock');
    // Landing/UI skills should still resolve via the landing bucket.
    expect(ids).toContain('frontend-design-anti-slop');
  });

  it('does NOT match mobile-mock for Chinese generic prototype — "做一个产品落地页的原型"', () => {
    const matched = matchSkillsToPrompt(all, '做一个产品落地页的原型');
    const ids = matched.map((s) => s.id);
    expect(ids).not.toContain('mobile-mock');
    expect(ids).toContain('frontend-design-anti-slop');
  });

  it('still matches mobile-mock when a mobile-only token co-occurs — "iPhone app prototype"', () => {
    const matched = matchSkillsToPrompt(all, 'iPhone app prototype');
    expect(matched.map((s) => s.id)).toContain('mobile-mock');
  });

  it('still matches mobile-mock for Chinese mobile-only prompt — "做一个移动端原型"', () => {
    const matched = matchSkillsToPrompt(all, '做一个移动端原型');
    expect(matched.map((s) => s.id)).toContain('mobile-mock');
  });

  // Regression: broad Chinese aliases 分析 / 应用 / 演示 must not fire their
  // group on their own. They are demoted to `weak` so substring hits inside
  // unrelated text (analyse this paragraph, web 应用, 演示一下功能) no longer
  // over-trigger dashboard / mobile-mock / pitch-deck.
  it('does NOT match dashboard for generic 分析 prompt — "分析这段文本"', () => {
    const matched = matchSkillsToPrompt(all, '分析这段文本');
    expect(matched.map((s) => s.id)).not.toContain('data-viz-recharts');
  });

  it('does NOT match mobile-mock for generic 应用 prompt — "Web 应用程序员"', () => {
    const matched = matchSkillsToPrompt(all, 'Web 应用程序员');
    expect(matched.map((s) => s.id)).not.toContain('mobile-mock');
  });

  it('does NOT match pitch-deck for generic 演示 prompt — "演示一下功能"', () => {
    const matched = matchSkillsToPrompt(all, '演示一下功能');
    expect(matched.map((s) => s.id)).not.toContain('pitch-deck');
  });

  // True positives for the same buckets must still resolve via strong tokens.
  it('still matches dashboard for "数据看板"', () => {
    const matched = matchSkillsToPrompt(all, '做一个数据看板');
    expect(matched.map((s) => s.id)).toContain('data-viz-recharts');
  });

  it('still matches mobile-mock for English "iPhone app"', () => {
    const matched = matchSkillsToPrompt(all, 'design an iPhone app');
    expect(matched.map((s) => s.id)).toContain('mobile-mock');
  });

  it('still matches pitch-deck for "做一个 PPT"', () => {
    const matched = matchSkillsToPrompt(all, '帮我做一个 PPT');
    expect(matched.map((s) => s.id)).toContain('pitch-deck');
  });
});
