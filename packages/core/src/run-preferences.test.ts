import { completeWithRetry } from '@open-codesign/providers';
import { describe, expect, it, vi } from 'vitest';
import {
  applyRunPreferenceAnswers,
  defaultRunPreferences,
  normalizeRunPreferencesRouterResult,
  RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT,
  routeRunPreferences,
  runPreferencesFromJson,
} from './run-preferences.js';

vi.mock('@open-codesign/providers', () => ({ completeWithRetry: vi.fn() }));

describe('live preference routing without an interview', () => {
  it('ignores legacy model questions while preserving routed explicit preferences', async () => {
    vi.mocked(completeWithRetry).mockResolvedValueOnce({
      content: JSON.stringify({
        preferences: {
          tweaks: 'no',
          routing: { tweaks: { provenance: 'explicit', confidence: 'high' } },
        },
        needsClarification: true,
        clarificationRationale: 'Pick a style before building',
        clarificationQuestions: [{ id: 'style', type: 'freeform', prompt: 'Which visual style?' }],
      }),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    const result = await routeRunPreferences({
      prompt: 'Make a poster',
      existingPreferences: null,
      model: { provider: 'mock', modelId: 'mock' },
      apiKey: 'test',
    });
    expect(result).toMatchObject({
      preferences: { tweaks: 'no', routing: { tweaks: { provenance: 'explicit' } } },
      needsClarification: false,
    });
    expect(result.clarificationQuestions).toBeUndefined();
    expect(result.clarificationRationale).toBeUndefined();
    expect(RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT).toContain('not an interview stage');
    expect(RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT).not.toContain('Prefer 1 question');
  });
});

describe('run preferences semantic router normalization', () => {
  it('distinguishes known reference files from generated source and unknown inventory omissions', () => {
    expect(RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT).toContain('workspaceState.fileInventory.paths');
    expect(RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT).toContain('unknown, not proven absent');
    expect(RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT).toContain(
      'Never ask the user to re-upload listed files',
    );
    expect(RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT).toContain('including workspace DESIGN.md');
  });
  it('normalizes complete router output with routing metadata', () => {
    const result = normalizeRunPreferencesRouterResult(
      {
        preferences: {
          tweaks: 'no',
          bitmapAssets: 'yes',
          reusableSystem: 'auto',
          visualDirection: 'professional',
          routing: {
            tweaks: { provenance: 'explicit', confidence: 'high', reason: 'user declined' },
            bitmapAssets: { provenance: 'inferred', confidence: 'medium' },
            reusableSystem: { provenance: 'default', confidence: 'low' },
            visualDirection: { provenance: 'inferred', confidence: 'medium' },
          },
        },
      },
      null,
    );

    expect(result.preferences).toMatchObject({
      tweaks: 'no',
      bitmapAssets: 'yes',
      reusableSystem: 'auto',
      visualDirection: 'professional',
      routing: {
        tweaks: { provenance: 'explicit', confidence: 'high' },
        bitmapAssets: { provenance: 'inferred', confidence: 'medium' },
      },
    });
  });

  it('defaults missing fields to auto default low', () => {
    const result = normalizeRunPreferencesRouterResult({ preferences: { tweaks: 'yes' } }, null);

    expect(result.preferences).toMatchObject({
      tweaks: 'yes',
      bitmapAssets: 'auto',
      reusableSystem: 'auto',
      routing: {
        bitmapAssets: { provenance: 'default', confidence: 'low' },
        reusableSystem: { provenance: 'default', confidence: 'low' },
      },
    });
  });

  it('falls back on invalid JSON content', () => {
    const fallback = {
      ...defaultRunPreferences(),
      tweaks: 'yes' as const,
    };

    expect(runPreferencesFromJson('not json', fallback).preferences.tweaks).toBe('yes');
  });

  it('keeps natural clarification copy from router output', () => {
    const result = normalizeRunPreferencesRouterResult(
      {
        preferences: defaultRunPreferences(),
        needsClarification: true,
        clarificationRationale: '这个选择会决定首版是偏训练中抬腕速读，还是偏复盘展示。',
        clarificationQuestions: [
          {
            id: 'watchMoment',
            type: 'text-options',
            prompt: '这块 Apple Watch 屏幕更像哪个瞬间？',
            options: ['跑步中抬腕速读', '结束后的复盘卡片', '教练提醒弹出'],
          },
          {
            id: 'extraContext',
            type: 'freeform',
            prompt: '还有必须保留的指标吗？',
            placeholder: '比如 heart-rate zone 或 haptic cue',
          },
        ],
      },
      null,
    );

    expect(result.needsClarification).toBe(true);
    expect(result.clarificationRationale).toBe(
      '这个选择会决定首版是偏训练中抬腕速读，还是偏复盘展示。',
    );
    expect(result.clarificationQuestions).toEqual([
      {
        id: 'watchMoment',
        type: 'text-options',
        prompt: '这块 Apple Watch 屏幕更像哪个瞬间？',
        options: ['跑步中抬腕速读', '结束后的复盘卡片', '教练提醒弹出'],
      },
      {
        id: 'extraContext',
        type: 'freeform',
        prompt: '还有必须保留的指标吗？',
        placeholder: '比如 heart-rate zone 或 haptic cue',
      },
    ]);
  });

  it('caps router-authored clarification to two focused questions', () => {
    const result = normalizeRunPreferencesRouterResult(
      {
        preferences: defaultRunPreferences(),
        needsClarification: true,
        clarificationQuestions: [
          { id: 'one', type: 'text-options', prompt: 'One?', options: ['a', 'b'] },
          { id: 'two', type: 'text-options', prompt: 'Two?', options: ['a', 'b'] },
          { id: 'three', type: 'text-options', prompt: 'Three?', options: ['a', 'b'] },
        ],
      },
      null,
    );

    expect(result.clarificationQuestions?.map((q) => q.id)).toEqual(['one', 'two']);
  });

  it('applies structured user answers without parsing prompt text', () => {
    const next = applyRunPreferenceAnswers(defaultRunPreferences(), [
      { questionId: 'tweaks', value: 'no' },
      { questionId: 'bitmapAssets', value: 'yes' },
    ]);

    expect(next).toMatchObject({
      tweaks: 'no',
      bitmapAssets: 'yes',
      routing: {
        tweaks: { provenance: 'explicit', confidence: 'high' },
        bitmapAssets: { provenance: 'explicit', confidence: 'high' },
      },
    });
  });
});
