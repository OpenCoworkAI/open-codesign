import type { ChatMessage, LoadedSkill } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { formatSkillsForPrompt, injectSkillsIntoMessages } from './skill-injector.js';

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
// injectSkillsIntoMessages — unchanged behaviour, retained as smoke test
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
    expect(result).toHaveLength(BASE_MESSAGES.length);
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toContain('Body of test-skill.');
    expect(result[0]?.content).toContain('You are a helpful assistant.');
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
    expect(result).toBe(BASE_MESSAGES);
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

    const expectedOrder = ['Beta body.', 'Mango body.', 'Alpha body.', 'Gamma body.', 'Zeta body.'];
    const indices = expectedOrder.map((needle) => canonicalContent.indexOf(needle));
    expect(indices.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i - 1]).toBeLessThan(indices[i] as number);
    }
  });
});

// ---------------------------------------------------------------------------
// injectSkillsIntoMessages — explicit coverage for surviving behaviour
// (replaces invariants previously asserted via the removed keyword matcher)
// ---------------------------------------------------------------------------

describe('injectSkillsIntoMessages() — surviving behaviour', () => {
  it('returns the same messages reference when skills array is empty', () => {
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [], 'anthropic');
    expect(result).toBe(BASE_MESSAGES);
  });

  it('appends skill block before existing system message content, preserving order', () => {
    const skill = makeSkill('ordered');
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [skill], 'anthropic');
    expect(result).toHaveLength(BASE_MESSAGES.length);
    expect(result[0]?.role).toBe('system');
    const content = result[0]?.content ?? '';
    const blockIdx = content.indexOf('Body of ordered.');
    const existingIdx = content.indexOf('You are a helpful assistant.');
    expect(blockIdx).toBeGreaterThanOrEqual(0);
    expect(existingIdx).toBeGreaterThan(blockIdx);
  });

  it('inserts a new system message at position 0 when none exists', () => {
    const userOnly: ChatMessage[] = [{ role: 'user', content: 'Design a landing page.' }];
    const skill = makeSkill('fresh');
    const result = injectSkillsIntoMessages(userOnly, [skill], 'anthropic');
    expect(result).toHaveLength(userOnly.length + 1);
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toContain('Body of fresh.');
    expect(result[1]).toEqual(userOnly[0]);
  });

  it('drops a skill whose trigger.providers does not include the current provider', () => {
    const openaiOnly = makeSkill('openai-only', {
      frontmatter: {
        schemaVersion: 1,
        name: 'openai-only',
        description: 'OpenAI only.',
        trigger: { providers: ['openai'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
    });
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [openaiOnly], 'anthropic');
    expect(result).toBe(BASE_MESSAGES);
  });

  it('drops skills with disable_model_invocation: true', () => {
    const muted = makeSkill('muted', {
      frontmatter: {
        schemaVersion: 1,
        name: 'muted',
        description: 'Muted skill.',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: true,
        user_invocable: true,
      },
    });
    const result = injectSkillsIntoMessages(BASE_MESSAGES, [muted], 'anthropic');
    expect(result).toBe(BASE_MESSAGES);
  });

  it('includes formatted blobs for every active skill in the system content', () => {
    const skills: LoadedSkill[] = [
      makeSkill('one', { body: 'Body of one.' }),
      makeSkill('two', { body: 'Body of two.' }),
      makeSkill('three', { body: 'Body of three.' }),
    ];
    const result = injectSkillsIntoMessages(BASE_MESSAGES, skills, 'anthropic');
    const content = result[0]?.content ?? '';
    expect(content).toContain('## Skill: one');
    expect(content).toContain('## Skill: two');
    expect(content).toContain('## Skill: three');
    expect(content).toContain('Body of one.');
    expect(content).toContain('Body of two.');
    expect(content).toContain('Body of three.');
  });
});

// ---------------------------------------------------------------------------
// formatSkillsForPrompt — progressive-disclosure helper used by core/generate
// ---------------------------------------------------------------------------

describe('formatSkillsForPrompt()', () => {
  it('returns one blob per skill in canonical order', () => {
    const skills: LoadedSkill[] = [
      makeSkill('zeta', { source: 'builtin', body: 'Zeta body.' }),
      makeSkill('alpha', { source: 'project', body: 'Alpha body.' }),
      makeSkill('beta', { source: 'project', body: 'Beta body.' }),
    ];
    const blobs = formatSkillsForPrompt(skills);
    expect(blobs).toHaveLength(3);
    // project before builtin, alphabetical inside source
    expect(blobs[0]).toContain('Alpha body.');
    expect(blobs[1]).toContain('Beta body.');
    expect(blobs[2]).toContain('Zeta body.');
    expect(blobs[0]).toMatch(/^## Skill: alpha\n\n/);
  });

  it('returns empty array for empty input', () => {
    expect(formatSkillsForPrompt([])).toEqual([]);
  });

  it('does not gate on language — Chinese-only frontmatter still produces a blob', () => {
    // Regression: progressive disclosure must not depend on description language.
    // The old keyword matcher would drop these; the new helper formats them as-is.
    const cn = makeSkill('cn', {
      frontmatter: {
        schemaVersion: 1,
        name: 'cn',
        description: '为中文用户设计的技能',
        trigger: { providers: ['*'], scope: 'system' },
        disable_model_invocation: false,
        user_invocable: true,
      },
    });
    const blobs = formatSkillsForPrompt([cn]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toContain('Body of cn.');
  });

  it('formats four builtin-shaped skills into four blobs (level-1 disclosure)', () => {
    const all = ['data-viz-recharts', 'mobile-mock', 'frontend-design-anti-slop', 'pitch-deck'].map(
      (name) =>
        makeSkill(name, {
          source: 'builtin',
          frontmatter: {
            schemaVersion: 1,
            name,
            description: `English description for ${name}.`,
            trigger: { providers: ['*'], scope: 'system' },
            disable_model_invocation: false,
            user_invocable: true,
          },
          body: `Body of ${name}.`,
        }),
    );
    const blobs = formatSkillsForPrompt(all);
    expect(blobs).toHaveLength(4);
    // Alphabetical inside the builtin source.
    expect(blobs.map((b) => b.split('\n')[0])).toEqual([
      '## Skill: data-viz-recharts',
      '## Skill: frontend-design-anti-slop',
      '## Skill: mobile-mock',
      '## Skill: pitch-deck',
    ]);
  });
});
