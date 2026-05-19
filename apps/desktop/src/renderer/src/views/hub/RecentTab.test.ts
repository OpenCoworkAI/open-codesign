import type { Design } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildRecentDesigns, collapseWorkspaceDesigns } from './RecentTab';

function design(id: string, updatedAt: string, workspacePath: string | null = null): Design {
  return {
    schemaVersion: 1,
    id,
    name: id,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    thumbnailText: null,
    workspacePath,
  };
}

describe('buildRecentDesigns', () => {
  it('uses update time when no design is actively working', () => {
    const designs = [
      design('recent-1', '2026-05-05T11:00:00.000Z'),
      design('recent-2', '2026-05-05T10:00:00.000Z'),
      design('recent-3', '2026-05-05T09:00:00.000Z'),
      design('old-open-design', '2026-05-01T09:00:00.000Z'),
    ];

    expect(buildRecentDesigns(designs, {}, 3).map((d) => d.id)).toEqual([
      'recent-1',
      'recent-2',
      'recent-3',
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
        { 'working-old': { generationId: 'gen-old', stage: 'streaming' } },
        2,
      ).map((d) => d.id),
    ).toEqual(['working-old', 'recent-1']);
  });

  it('shows one card per workspace and keeps the newest session as the representative', () => {
    const designs = [
      design('new-session', '2026-05-05T11:00:00.000Z', 'C:\\Users\\me\\MotsDits'),
      design('old-session', '2026-05-05T10:00:00.000Z', 'c:/users/me/motsdits/'),
      design('other-workspace', '2026-05-05T09:00:00.000Z', 'C:/Users/me/Other'),
    ];

    expect(buildRecentDesigns(designs, {}, 6).map((d) => d.id)).toEqual([
      'new-session',
      'other-workspace',
    ]);
  });

  it('uses an active session as the workspace representative', () => {
    const designs = [
      design('new-idle-session', '2026-05-05T11:00:00.000Z', 'C:/Users/me/MotsDits'),
      design('old-working-session', '2026-05-05T10:00:00.000Z', 'C:/Users/me/MotsDits'),
    ];

    expect(
      buildRecentDesigns(
        designs,
        { 'old-working-session': { generationId: 'gen-old', stage: 'streaming' } },
        6,
      ).map((d) => d.id),
    ).toEqual(['old-working-session']);
  });

  it('does not collapse Windows root workspaces with empty paths', () => {
    expect(
      collapseWorkspaceDesigns([
        design('root-session', '2026-05-05T11:00:00.000Z', 'C:/'),
        design('same-root-session', '2026-05-05T10:00:00.000Z', 'c:/'),
        design('blank', '2026-05-05T09:00:00.000Z'),
      ]).map((d) => d.id),
    ).toEqual(['root-session', 'blank']);
  });

  it('does not collapse designs without a workspace path', () => {
    expect(
      collapseWorkspaceDesigns([
        design('blank-1', '2026-05-05T11:00:00.000Z'),
        design('blank-2', '2026-05-05T10:00:00.000Z'),
      ]).map((d) => d.id),
    ).toEqual(['blank-1', 'blank-2']);
  });
});
