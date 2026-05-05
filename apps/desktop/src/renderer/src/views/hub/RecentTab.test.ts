import type { Design } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildRecentDesigns } from './RecentTab';

function design(id: string, updatedAt: string): Design {
  return {
    schemaVersion: 1,
    id,
    name: id,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    thumbnailText: null,
    workspacePath: null,
  };
}

describe('buildRecentDesigns', () => {
  it('keeps the current design visible even when it is older than the normal limit', () => {
    const designs = [
      design('recent-1', '2026-05-05T11:00:00.000Z'),
      design('recent-2', '2026-05-05T10:00:00.000Z'),
      design('recent-3', '2026-05-05T09:00:00.000Z'),
      design('current-old', '2026-05-01T09:00:00.000Z'),
    ];

    expect(buildRecentDesigns(designs, 'current-old', {}, 3).map((d) => d.id)).toEqual([
      'current-old',
      'recent-1',
      'recent-2',
    ]);
  });

  it('keeps background working designs visible on the hub', () => {
    const designs = [
      design('recent-1', '2026-05-05T11:00:00.000Z'),
      design('recent-2', '2026-05-05T10:00:00.000Z'),
      design('working-old', '2026-05-01T09:00:00.000Z'),
    ];

    expect(
      buildRecentDesigns(
        designs,
        null,
        { 'working-old': { generationId: 'gen-old', stage: 'streaming' } },
        2,
      ).map((d) => d.id),
    ).toEqual(['working-old', 'recent-1']);
  });
});
