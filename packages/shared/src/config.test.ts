import { describe, expect, it } from 'vitest';
import { ConfigSchema, STORED_DESIGN_SYSTEM_SCHEMA_VERSION } from './config';

describe('ConfigSchema', () => {
  it('upgrades legacy designSystem snapshots to the versioned format', () => {
    const parsed = ConfigSchema.parse({
      version: 1,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      modelFast: 'gpt-4o-mini',
      secrets: {},
      baseUrls: {},
      designSystem: {
        rootPath: '/repo',
        summary: 'Warm neutral tokens',
        extractedAt: '2026-04-18T00:00:00.000Z',
        sourceFiles: ['tailwind.config.ts'],
        colors: ['#f4efe8'],
        fonts: ['IBM Plex Sans'],
        spacing: ['1rem'],
        radius: ['18px'],
        shadows: ['0 12px 40px rgba(0,0,0,0.12)'],
      },
    });

    expect(parsed.designSystem?.schemaVersion).toBe(STORED_DESIGN_SYSTEM_SCHEMA_VERSION);
    expect(parsed.designSystem?.rootPath).toBe('/repo');
  });
});
