import type { ChatMessage, LoadedSkill } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { injectSkillsIntoMessages } from './skill-injector.js';

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
});
