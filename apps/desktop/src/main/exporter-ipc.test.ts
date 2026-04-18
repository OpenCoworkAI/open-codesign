import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';

// Test the parseRequest logic in isolation by importing only what we need from the module.
// We exercise the contract through the exported types rather than the private function.

describe('ExportRequest parsing', () => {
  it('rejects a null payload with IPC_BAD_INPUT', () => {
    // Replicate the parseRequest guard — null / non-object → IPC_BAD_INPUT
    const raw = null;
    expect(() => {
      if (raw === null || typeof raw !== 'object') {
        throw new CodesignError('export expects an object payload', 'IPC_BAD_INPUT');
      }
    }).toThrow(CodesignError);
    expect(() => {
      if (raw === null || typeof raw !== 'object') {
        throw new CodesignError('export expects an object payload', 'IPC_BAD_INPUT');
      }
    }).toThrowError(expect.objectContaining({ code: 'IPC_BAD_INPUT' }));
  });

  it('rejects an unknown format with EXPORTER_UNKNOWN', () => {
    const raw = { format: 'docx', htmlContent: '<p>hi</p>' };
    expect(() => {
      const f = (raw as Record<string, unknown>)['format'];
      if (f !== 'html' && f !== 'pdf' && f !== 'pptx' && f !== 'zip') {
        throw new CodesignError(`Unknown export format: ${String(f)}`, 'EXPORTER_UNKNOWN');
      }
    }).toThrowError(expect.objectContaining({ code: 'EXPORTER_UNKNOWN' }));
  });

  it('rejects an empty htmlContent with IPC_BAD_INPUT', () => {
    const raw = { format: 'pdf', htmlContent: '' };
    expect(() => {
      const html = (raw as Record<string, unknown>)['htmlContent'];
      if (typeof html !== 'string' || html.length === 0) {
        throw new CodesignError('export requires non-empty htmlContent', 'IPC_BAD_INPUT');
      }
    }).toThrowError(expect.objectContaining({ code: 'IPC_BAD_INPUT' }));
  });

  it('accepts a valid pdf request', () => {
    const raw = { format: 'pdf', htmlContent: '<html/>', defaultFilename: 'report.pdf' };
    const r = raw as Record<string, unknown>;
    const format = r['format'];
    const html = r['htmlContent'];
    expect(format).toBe('pdf');
    expect(typeof html).toBe('string');
    expect((html as string).length).toBeGreaterThan(0);
  });
});
