import { describe, expect, it } from 'vitest';
import {
  ComponentSelectionV1,
  EngineeringConfigV1,
  EngineeringRunStateV1,
  LaunchEntryV1,
} from './engineering';
import { DesignV1 } from './snapshot';

describe('engineering schemas (U1)', () => {
  describe('LaunchEntryV1', () => {
    it('parses a high-confidence package script entry', () => {
      const parsed = LaunchEntryV1.parse({
        schemaVersion: 1,
        kind: 'package-script',
        value: 'dev',
        confidence: 'high',
        source: 'package-script',
      });
      expect(parsed.value).toBe('dev');
      expect(parsed.confidence).toBe('high');
    });

    it('rejects unknown kind', () => {
      expect(() =>
        LaunchEntryV1.parse({
          schemaVersion: 1,
          kind: 'unknown',
          value: 'dev',
          confidence: 'high',
          source: 'package-script',
        }),
      ).toThrow();
    });
  });

  describe('EngineeringConfigV1', () => {
    it('parses a complete config', () => {
      const parsed = EngineeringConfigV1.parse({
        schemaVersion: 1,
        framework: 'react',
        packageManager: 'pnpm',
        launchEntry: {
          schemaVersion: 1,
          kind: 'package-script',
          value: 'dev',
          confidence: 'high',
          source: 'package-script',
        },
        lastReadyUrl: null,
      });
      expect(parsed.framework).toBe('react');
      expect(parsed.lastReadyUrl).toBeNull();
    });

    it('defaults lastReadyUrl to null when omitted', () => {
      const parsed = EngineeringConfigV1.parse({
        framework: 'react',
        packageManager: 'pnpm',
        launchEntry: {
          kind: 'package-script',
          value: 'dev',
          confidence: 'high',
          source: 'package-script',
        },
      });
      expect(parsed.lastReadyUrl).toBeNull();
    });
  });

  describe('EngineeringRunStateV1', () => {
    it('parses an error state with last error and excerpt', () => {
      const parsed = EngineeringRunStateV1.parse({
        designId: 'd1',
        status: 'error',
        readyUrl: null,
        lastError: {
          kind: 'launch',
          message: 'spawn ENOENT',
          excerpt: ['line 1', 'line 2'],
          command: 'pnpm dev',
        },
        logs: [],
        updatedAt: '2026-04-28T00:00:00.000Z',
      });
      expect(parsed.status).toBe('error');
      expect(parsed.lastError?.kind).toBe('launch');
    });

    it('rejects when status is missing', () => {
      expect(() =>
        EngineeringRunStateV1.parse({
          designId: 'd1',
          updatedAt: '2026-04-28T00:00:00.000Z',
        }),
      ).toThrow();
    });
  });

  describe('ComponentSelectionV1', () => {
    it('parses a fully populated selection', () => {
      const parsed = ComponentSelectionV1.parse({
        componentName: 'MyButton',
        filePath: 'src/Button.tsx',
        ownerChain: ['MyButton', 'Toolbar', 'App'],
        debugSource: { fileName: '/abs/src/Button.tsx', lineNumber: 10 },
        domSelector: '/html/body/div[1]/button[1]',
      });
      expect(parsed.componentName).toBe('MyButton');
      expect(parsed.ownerChain).toHaveLength(3);
    });

    it('defaults filePath, ownerChain, debugSource when omitted', () => {
      const parsed = ComponentSelectionV1.parse({
        componentName: 'Anonymous',
        domSelector: '/html/body/div[1]',
      });
      expect(parsed.filePath).toBeNull();
      expect(parsed.ownerChain).toEqual([]);
      expect(parsed.debugSource).toBeNull();
    });
  });

  describe('DesignV1 back-compat', () => {
    it('parses a legacy v0.1 design row without mode/engineering fields', () => {
      const parsed = DesignV1.parse({
        id: 'd1',
        name: 'My design',
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
        thumbnailText: null,
        deletedAt: null,
        workspacePath: null,
      });
      // Optional in the inferred type — readers treat undefined as 'generative'.
      expect(parsed.mode ?? 'generative').toBe('generative');
      expect(parsed.engineering ?? null).toBeNull();
    });

    it('parses an engineering-mode design row', () => {
      const parsed = DesignV1.parse({
        id: 'd2',
        name: 'My react app',
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
        thumbnailText: null,
        deletedAt: null,
        workspacePath: '/path/to/repo',
        mode: 'engineering',
        engineering: {
          framework: 'react',
          packageManager: 'pnpm',
          launchEntry: {
            kind: 'package-script',
            value: 'dev',
            confidence: 'high',
            source: 'package-script',
          },
          lastReadyUrl: null,
        },
      });
      expect(parsed.mode).toBe('engineering');
      expect(parsed.engineering?.framework).toBe('react');
    });
  });
});
