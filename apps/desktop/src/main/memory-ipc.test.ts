import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockUserDataPath = '/tmp/test-memory-ipc';

vi.mock('./electron-runtime', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? mockUserDataPath : '/tmp') },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('./db/designs', () => ({
  listDesigns: vi.fn(() => []),
}));

vi.mock('@open-codesign/core', async () => {
  const actual = await vi.importActual<typeof import('@open-codesign/core')>('@open-codesign/core');
  return {
    ...actual,
    updateDesignMemory: vi.fn(async () => ({
      content: '# Updated Memory',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    })),
  };
});

import { updateDesignMemory } from '@open-codesign/core';
import {
  loadMemoryContext,
  readDesignMemoryFile,
  triggerMemoryUpdate,
  writeDesignMemoryFile,
} from './memory-ipc';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'memory-ipc-test-'));
  mockUserDataPath = tempDir;
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('readDesignMemoryFile', () => {
  it('returns content when memory.md exists', async () => {
    await writeFile(path.join(tempDir, 'memory.md'), '# Test Memory', 'utf-8');
    const result = await readDesignMemoryFile(tempDir);
    expect(result).toBe('# Test Memory');
  });

  it('returns null when file does not exist', async () => {
    const result = await readDesignMemoryFile(path.join(tempDir, 'nonexistent'));
    expect(result).toBeNull();
  });
});

describe('writeDesignMemoryFile', () => {
  it('writes memory file atomically', async () => {
    await writeDesignMemoryFile(tempDir, '# Written Memory');
    const content = await readFile(path.join(tempDir, 'memory.md'), 'utf-8');
    expect(content).toBe('# Written Memory');
  });

  it('overwrites existing content', async () => {
    await writeDesignMemoryFile(tempDir, '# First');
    await writeDesignMemoryFile(tempDir, '# Second');
    const content = await readFile(path.join(tempDir, 'memory.md'), 'utf-8');
    expect(content).toBe('# Second');
  });

  it('creates the workspace directory before writing memory', async () => {
    const workspace = path.join(tempDir, 'missing-workspace');
    await writeDesignMemoryFile(workspace, '# New Workspace Memory');
    const content = await readFile(path.join(workspace, 'memory.md'), 'utf-8');
    expect(content).toBe('# New Workspace Memory');
  });
});

describe('loadMemoryContext', () => {
  it('returns undefined when no memory files exist', async () => {
    const result = await loadMemoryContext(path.join(tempDir, 'no-workspace'));
    expect(result).toBeUndefined();
  });

  it('loads design memory into context', async () => {
    await writeFile(path.join(tempDir, 'memory.md'), '# Design Memory', 'utf-8');
    const result = await loadMemoryContext(tempDir);
    expect(result).toBeDefined();
    expect(result?.length).toBeGreaterThan(0);
    expect(result?.some((s) => s.includes('Design Memory'))).toBe(true);
  });

  it('returns undefined for undefined workspace path', async () => {
    const result = await loadMemoryContext(undefined);
    expect(result).toBeUndefined();
  });

  it('does not inject the global memory index by default', async () => {
    await writeFile(path.join(tempDir, 'memory.md'), 'global|Other|Different project', 'utf-8');
    const result = await loadMemoryContext(path.join(tempDir, 'workspace-without-memory'));
    expect(result).toBeUndefined();
  });
});

describe('triggerMemoryUpdate', () => {
  it('calls updateDesignMemory and writes result', async () => {
    await triggerMemoryUpdate({
      workspacePath: tempDir,
      designId: 'test-id',
      designName: 'Test Design',
      conversationMessages: [],
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      apiKey: 'test-key',
      reasoningLevel: 'off',
      db: null,
    });

    expect(updateDesignMemory).toHaveBeenCalledOnce();
    expect(updateDesignMemory).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningLevel: 'off' }),
    );
    const content = await readFile(path.join(tempDir, 'memory.md'), 'utf-8');
    expect(content).toBe('# Updated Memory');
  });

  it('chains concurrent updates for the same design instead of dropping', async () => {
    const first = triggerMemoryUpdate({
      workspacePath: tempDir,
      designId: 'dup-id',
      designName: 'Dup Design',
      conversationMessages: [],
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      apiKey: 'test-key',
      db: null,
    });

    const second = triggerMemoryUpdate({
      workspacePath: tempDir,
      designId: 'dup-id',
      designName: 'Dup Design',
      conversationMessages: [],
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      apiKey: 'test-key',
      db: null,
    });

    await Promise.all([first, second]);
    expect(updateDesignMemory).toHaveBeenCalledTimes(2);
  });

  it('allows update after previous one completes', async () => {
    await triggerMemoryUpdate({
      workspacePath: tempDir,
      designId: 'seq-id',
      designName: 'Seq Design',
      conversationMessages: [],
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      apiKey: 'test-key',
      db: null,
    });

    await triggerMemoryUpdate({
      workspacePath: tempDir,
      designId: 'seq-id',
      designName: 'Seq Design',
      conversationMessages: [],
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      apiKey: 'test-key',
      db: null,
    });

    expect(updateDesignMemory).toHaveBeenCalledTimes(2);
  });
});
