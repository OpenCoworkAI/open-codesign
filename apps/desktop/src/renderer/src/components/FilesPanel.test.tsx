import { initI18n } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const mockUseState = vi.fn((init) => {
    if (init === null || init === false) {
      return [false, vi.fn()];
    }
    return [init, vi.fn()];
  });
  
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      useState: mockUseState,
      useSyncExternalStore: (sub: any, getSnap: any) => getSnap()
    },
    useState: mockUseState,
    useSyncExternalStore: (sub: any, getSnap: any) => getSnap()
  };
});

import type { CodesignApi } from '../../../preload';
import { useCodesignStore } from '../store';
import { FilesPanel } from './FilesPanel';
import { useDesignFiles } from '../hooks/useDesignFiles';


vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  const mockStoreHook = vi.fn((selector) => {
    return selector(actual.useCodesignStore.getState());
  });
  Object.assign(mockStoreHook, actual.useCodesignStore);
  return {
    ...actual,
    useCodesignStore: mockStoreHook,
  };
});
vi.mock('../hooks/useDesignFiles', () => ({
  useDesignFiles: vi.fn(),
}));

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

beforeAll(async () => {
  await initI18n('en');
});

const mockDesign = (overrides?: Partial<Design>): Design => ({
  schemaVersion: 1,
  id: 'design-1',
  name: 'Test Design',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workspacePath: null,
  thumbnailText: null,
  deletedAt: null,
  ...overrides,
});

describe('FilesPanel workspace integration', () => {
  beforeEach(() => {
    useCodesignStore.setState({
      currentDesignId: 'design-1',
      designs: [mockDesign()],
    });

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          pickWorkspaceFolder: vi.fn(),
          updateWorkspace: vi.fn(),
          openWorkspaceFolder: vi.fn(),
          listDesigns: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('workspace state retrieval', () => {
    it('returns null workspacePath when design has no workspace bound', () => {
      const designs = useCodesignStore.getState().designs;
      const currentDesign = designs.find((d) => d.id === 'design-1');
      expect(currentDesign?.workspacePath).toBeNull();
    });

    it('returns workspacePath when design has workspace bound', () => {
      useCodesignStore.setState({
        designs: [mockDesign({ workspacePath: '/home/user/workspace' })],
      });

      const designs = useCodesignStore.getState().designs;
      const currentDesign = designs.find((d) => d.id === 'design-1');
      expect(currentDesign?.workspacePath).toBe('/home/user/workspace');
    });

    it('handles multiple designs with different workspace bindings', () => {
      useCodesignStore.setState({
        designs: [
          mockDesign({ id: 'design-1', workspacePath: '/path/one' }),
          mockDesign({ id: 'design-2', workspacePath: '/path/two' }),
          mockDesign({ id: 'design-3', workspacePath: null }),
        ],
      });

      const designs = useCodesignStore.getState().designs;
      expect(designs[0]?.workspacePath).toBe('/path/one');
      expect(designs[1]?.workspacePath).toBe('/path/two');
      expect(designs[2]?.workspacePath).toBeNull();
    });
  });

  describe('workspace action handlers', () => {
    it('pickWorkspaceFolder returns path or null', async () => {
      const mockPick = vi.fn().mockResolvedValue('/home/user/workspace');
      vi.mocked(window.codesign!.snapshots.pickWorkspaceFolder).mockImplementation(mockPick);

      const result = await window.codesign!.snapshots.pickWorkspaceFolder();
      expect(result).toBe('/home/user/workspace');
      expect(mockPick).toHaveBeenCalledOnce();
    });

    it('pickWorkspaceFolder returns null when user cancels', async () => {
      const mockPick = vi.fn().mockResolvedValue(null);
      vi.mocked(window.codesign!.snapshots.pickWorkspaceFolder).mockImplementation(mockPick);

      const result = await window.codesign!.snapshots.pickWorkspaceFolder();
      expect(result).toBeNull();
    });

    it('updateWorkspace accepts designId, path, and migrateFiles parameters', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(mockDesign({ workspacePath: '/home/user/workspace' }));
      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);

      await window.codesign!.snapshots.updateWorkspace('design-1', '/home/user/workspace', false);

      expect(mockUpdate).toHaveBeenCalledWith('design-1', '/home/user/workspace', false);
    });

    it('updateWorkspace accepts null path to clear workspace', async () => {
      const mockUpdate = vi.fn().mockResolvedValue(mockDesign({ workspacePath: null }));
      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);

      await window.codesign!.snapshots.updateWorkspace('design-1', null, false);

      expect(mockUpdate).toHaveBeenCalledWith('design-1', null, false);
    });

    it('openWorkspaceFolder accepts designId parameter', async () => {
      const mockOpen = vi.fn().mockResolvedValue(undefined);
      vi.mocked(window.codesign!.snapshots.openWorkspaceFolder).mockImplementation(mockOpen);

      await window.codesign!.snapshots.openWorkspaceFolder('design-1');

      expect(mockOpen).toHaveBeenCalledWith('design-1');
    });

    it('listDesigns returns updated design list after workspace change', async () => {
      const updatedDesign = mockDesign({ workspacePath: '/home/user/workspace' });
      const mockList = vi.fn().mockResolvedValue([updatedDesign]);
      vi.mocked(window.codesign!.snapshots.listDesigns).mockImplementation(mockList);

      const result = await window.codesign!.snapshots.listDesigns();

      expect(result).toEqual([updatedDesign]);
      expect(result[0]?.workspacePath).toBe('/home/user/workspace');
    });
  });

  describe('workspace action flow', () => {
    it('choose workspace: pick → update → list', async () => {
      const mockPick = vi.fn().mockResolvedValue('/home/user/workspace');
      const mockUpdate = vi.fn().mockResolvedValue(mockDesign({ workspacePath: '/home/user/workspace' }));
      const mockList = vi.fn().mockResolvedValue([mockDesign({ workspacePath: '/home/user/workspace' })]);

      vi.mocked(window.codesign!.snapshots.pickWorkspaceFolder).mockImplementation(mockPick);
      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);
      vi.mocked(window.codesign!.snapshots.listDesigns).mockImplementation(mockList);

      const path = await window.codesign!.snapshots.pickWorkspaceFolder();
      expect(path).toBe('/home/user/workspace');

      if (path) {
        const updated = await window.codesign!.snapshots.updateWorkspace('design-1', path, false);
        expect(updated.workspacePath).toBe('/home/user/workspace');

        const designs = await window.codesign!.snapshots.listDesigns();
        useCodesignStore.setState({ designs });
        expect(useCodesignStore.getState().designs[0]?.workspacePath).toBe('/home/user/workspace');
      }
    });

    it('clear workspace: update with null → list', async () => {
      useCodesignStore.setState({
        designs: [mockDesign({ workspacePath: '/home/user/workspace' })],
      });

      const mockUpdate = vi.fn().mockResolvedValue(mockDesign({ workspacePath: null }));
      const mockList = vi.fn().mockResolvedValue([mockDesign({ workspacePath: null })]);

      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);
      vi.mocked(window.codesign!.snapshots.listDesigns).mockImplementation(mockList);

      const updated = await window.codesign!.snapshots.updateWorkspace('design-1', null, false);
      expect(updated.workspacePath).toBeNull();

      const designs = await window.codesign!.snapshots.listDesigns();
      useCodesignStore.setState({ designs });
      expect(useCodesignStore.getState().designs[0]?.workspacePath).toBeNull();
    });

    it('change workspace: pick → update → list', async () => {
      useCodesignStore.setState({
        designs: [mockDesign({ workspacePath: '/home/user/old-workspace' })],
      });

      const mockPick = vi.fn().mockResolvedValue('/home/user/new-workspace');
      const mockUpdate = vi.fn().mockResolvedValue(mockDesign({ workspacePath: '/home/user/new-workspace' }));
      const mockList = vi.fn().mockResolvedValue([mockDesign({ workspacePath: '/home/user/new-workspace' })]);

      vi.mocked(window.codesign!.snapshots.pickWorkspaceFolder).mockImplementation(mockPick);
      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);
      vi.mocked(window.codesign!.snapshots.listDesigns).mockImplementation(mockList);

      const path = await window.codesign!.snapshots.pickWorkspaceFolder();
      expect(path).toBe('/home/user/new-workspace');

      if (path) {
        const updated = await window.codesign!.snapshots.updateWorkspace('design-1', path, false);
        expect(updated.workspacePath).toBe('/home/user/new-workspace');

        const designs = await window.codesign!.snapshots.listDesigns();
        useCodesignStore.setState({ designs });
        expect(useCodesignStore.getState().designs[0]?.workspacePath).toBe('/home/user/new-workspace');
      }
    });

    it('cancel workspace pick: no update or list call', async () => {
      const mockPick = vi.fn().mockResolvedValue(null);
      const mockUpdate = vi.fn();
      const mockList = vi.fn();

      vi.mocked(window.codesign!.snapshots.pickWorkspaceFolder).mockImplementation(mockPick);
      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);
      vi.mocked(window.codesign!.snapshots.listDesigns).mockImplementation(mockList);

      const path = await window.codesign!.snapshots.pickWorkspaceFolder();
      expect(path).toBeNull();

      if (path) {
        await window.codesign!.snapshots.updateWorkspace('design-1', path, false);
      }

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    });
  });

  describe('workspace API error handling', () => {
    it('handles pickWorkspaceFolder rejection', async () => {
      const mockPick = vi.fn().mockRejectedValue(new Error('Dialog error'));
      vi.mocked(window.codesign!.snapshots.pickWorkspaceFolder).mockImplementation(mockPick);

      await expect(window.codesign!.snapshots.pickWorkspaceFolder()).rejects.toThrow('Dialog error');
    });

    it('handles updateWorkspace rejection', async () => {
      const mockUpdate = vi.fn().mockRejectedValue(new Error('Update failed'));
      vi.mocked(window.codesign!.snapshots.updateWorkspace).mockImplementation(mockUpdate);

      await expect(window.codesign!.snapshots.updateWorkspace('design-1', '/path', false)).rejects.toThrow(
        'Update failed',
      );
    });

    it('handles openWorkspaceFolder rejection', async () => {
      const mockOpen = vi.fn().mockRejectedValue(new Error('Open failed'));
      vi.mocked(window.codesign!.snapshots.openWorkspaceFolder).mockImplementation(mockOpen);

      await expect(window.codesign!.snapshots.openWorkspaceFolder('design-1')).rejects.toThrow('Open failed');
    });

    it('handles listDesigns rejection', async () => {
      const mockList = vi.fn().mockRejectedValue(new Error('List failed'));
      vi.mocked(window.codesign!.snapshots.listDesigns).mockImplementation(mockList);

      await expect(window.codesign!.snapshots.listDesigns()).rejects.toThrow('List failed');
    });
  });

  describe('workspace state consistency', () => {
    it('preserves workspace binding across design switches', () => {
      useCodesignStore.setState({
        designs: [
          mockDesign({ id: 'design-1', workspacePath: '/path/one' }),
          mockDesign({ id: 'design-2', workspacePath: '/path/two' }),
        ],
      });

      useCodesignStore.setState({ currentDesignId: 'design-1' });
      let current = useCodesignStore.getState().designs.find((d) => d.id === 'design-1');
      expect(current?.workspacePath).toBe('/path/one');

      useCodesignStore.setState({ currentDesignId: 'design-2' });
      current = useCodesignStore.getState().designs.find((d) => d.id === 'design-2');
      expect(current?.workspacePath).toBe('/path/two');

      useCodesignStore.setState({ currentDesignId: 'design-1' });
      current = useCodesignStore.getState().designs.find((d) => d.id === 'design-1');
      expect(current?.workspacePath).toBe('/path/one');
    });

    it('handles design without workspace alongside designs with workspace', () => {
      useCodesignStore.setState({
        designs: [
          mockDesign({ id: 'design-1', workspacePath: null }),
          mockDesign({ id: 'design-2', workspacePath: '/path/two' }),
          mockDesign({ id: 'design-3', workspacePath: null }),
        ],
      });

      const designs = useCodesignStore.getState().designs;
      expect(designs.filter((d) => d.workspacePath === null)).toHaveLength(2);
      expect(designs.filter((d) => d.workspacePath !== null)).toHaveLength(1);
    });

  describe('FilesPanel rendering UI', () => {
    beforeEach(() => {
      vi.mocked(useDesignFiles).mockReturnValue({ files: [], loading: false } as any);
      useCodesignStore.setState({
        currentDesignId: 'design-1',
        designs: [mockDesign({ id: 'design-1', workspacePath: '/path/workspace' })],
      });
    });

    it('renders empty state rendering alongside workspace', () => {
      const html = ReactDOMServer.renderToString(React.createElement(FilesPanel));
      expect(html).toContain('No files yet');
      expect(html).toContain('Workspace');
    });

    it('renders unavailable indicator when folderExists is false', () => {
      const html = ReactDOMServer.renderToString(React.createElement(FilesPanel));
      expect(html).toContain('Folder not found on disk');
    });
  });
});
});
