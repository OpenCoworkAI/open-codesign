import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { exportAssetOptions, parseRequest } from './exporter-ipc';

describe('parseRequest', () => {
  it('rejects a null payload with IPC_BAD_INPUT', () => {
    expect(() => parseRequest(null)).toThrow(CodesignError);
    expect(() => parseRequest(null)).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects an unknown format with EXPORTER_UNKNOWN', () => {
    expect(() => parseRequest({ format: 'docx', htmlContent: '<p>hi</p>' })).toThrowError(
      expect.objectContaining({ code: 'EXPORTER_UNKNOWN' }),
    );
  });

  it('rejects an empty htmlContent with IPC_BAD_INPUT', () => {
    expect(() => parseRequest({ format: 'pdf', htmlContent: '' })).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('accepts a valid pdf request', () => {
    const result = parseRequest({
      format: 'pdf',
      htmlContent: '<html/>',
      defaultFilename: 'report.pdf',
    });
    expect(result.format).toBe('pdf');
    expect(result.htmlContent).toBe('<html/>');
    expect(result.defaultFilename).toBe('report.pdf');
  });

  it('accepts workspace source context for local asset exports', () => {
    const result = parseRequest({
      format: 'zip',
      htmlContent: '<img src="assets/logo.svg">',
      workspacePath: '/workspace',
      sourcePath: 'screens/home/index.html',
    });

    expect(result.workspacePath).toBe('/workspace');
    expect(result.sourcePath).toBe('screens/home/index.html');
    expect(exportAssetOptions(result)).toMatchObject({
      assetRootPath: '/workspace',
    });
  });
});
