import type { Design } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { chatSessionsForWorkspace } from './ChatSessionTabBar';

function design(input: Pick<Design, 'id' | 'name' | 'workspacePath'>): Design {
  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    thumbnailText: null,
    deletedAt: null,
    workspacePath: input.workspacePath,
  };
}

describe('chatSessionsForWorkspace', () => {
  it('groups Windows workspace conversations without relying on navigator.platform', () => {
    const current = design({ id: 'a', name: 'Chat A', workspacePath: 'C:/Work/Project' });
    const sameWorkspace = design({ id: 'b', name: 'Chat B', workspacePath: 'c:/work/project/' });
    const otherWorkspace = design({ id: 'c', name: 'Chat C', workspacePath: 'C:/Work/Other' });

    expect(chatSessionsForWorkspace([current, sameWorkspace, otherWorkspace], current)).toEqual([
      current,
      sameWorkspace,
    ]);
  });

  it('keeps unbound designs isolated', () => {
    const current = design({ id: 'a', name: 'Chat A', workspacePath: null });
    const other = design({ id: 'b', name: 'Chat B', workspacePath: null });

    expect(chatSessionsForWorkspace([current, other], current)).toEqual([current]);
  });
});
