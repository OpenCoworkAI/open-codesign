import { describe, expect, it } from 'vitest';
import {
  applyRunPreferenceAnswers,
  defaultRunPreferences,
  normalizeRunPreferencesRouterResult,
  runPreferencesFromJson,
} from './run-preferences.js';

describe('run preferences semantic router normalization', () => {
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

  it('keeps clarification questions from router output', () => {
    const result = normalizeRunPreferencesRouterResult(
      {
        preferences: defaultRunPreferences(),
        needsClarification: true,
        clarificationQuestions: [
          {
            id: 'bitmapAssets',
            type: 'text-options',
            prompt: 'Generate bitmap imagery?',
            options: ['auto', 'no', 'yes'],
          },
          {
            id: 'visualDirection',
            type: 'text-options',
            prompt: 'Preferred visual direction?',
            options: ['professional', 'editorial', 'bold', 'custom'],
          },
        ],
      },
      null,
    );

    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestions).toHaveLength(2);
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
