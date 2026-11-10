import { describe, expect, it, vi } from 'vitest';
import { clipboardFilesToWorkspaceBlobs, dataTransferFilesToWorkspaceFiles } from './file-ingest';

describe('file ingest helpers', () => {
  it('extracts local filesystem paths from dropped files', () => {
    const file = { name: 'brief.md', size: 12, path: '/tmp/brief.md' } as File & { path: string };
    const transfer = { files: [file] } as unknown as DataTransfer;

    expect(dataTransferFilesToWorkspaceFiles(transfer)).toEqual([
      { path: '/tmp/brief.md', name: 'brief.md', size: 12 },
    ]);
  });

  it('ignores plain text paste with no file payload', async () => {
    const clipboard = { files: [] } as unknown as DataTransfer;
    await expect(clipboardFilesToWorkspaceBlobs(clipboard)).resolves.toEqual({
      files: [],
      blobs: [],
    });
  });

  it('turns pasted screenshot files into base64 workspace blobs', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const clipboard = { files: [file] } as unknown as DataTransfer;
    vi.stubGlobal('btoa', (input: string) => Buffer.from(input, 'binary').toString('base64'));

    await expect(clipboardFilesToWorkspaceBlobs(clipboard)).resolves.toEqual({
      files: [],
      blobs: [{ name: 'image.png', mediaType: 'image/png', dataBase64: 'AQID' }],
    });
  });

  it.each([
    'image/jpeg',
    'image/webp',
  ])('preserves unnamed %s clipboard files for MIME-based naming', async (mediaType) => {
    const file = new File([new Uint8Array([1, 2, 3])], '', { type: mediaType });
    const clipboard = { files: [file] } as unknown as DataTransfer;
    await expect(clipboardFilesToWorkspaceBlobs(clipboard)).resolves.toEqual({
      files: [],
      blobs: [{ name: '', mediaType, dataBase64: 'AQID' }],
    });
  });

  it('keeps large clipboard image files on the main-process copy path', async () => {
    const arrayBuffer = vi.fn();
    const file = {
      name: 'render.png',
      size: 100_000_000,
      type: 'image/png',
      path: 'D:\\render.png',
      arrayBuffer,
    } as unknown as File & { path: string };
    const clipboard = { files: [file] } as unknown as DataTransfer;
    await expect(clipboardFilesToWorkspaceBlobs(clipboard)).resolves.toEqual({
      files: [{ path: 'D:\\render.png', name: 'render.png', size: 100_000_000 }],
      blobs: [],
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('keeps ordinary clipboard files on the main-process copy path', async () => {
    const arrayBuffer = vi.fn();
    const file = {
      name: 'brief.pdf',
      size: 100_000_000,
      type: 'application/pdf',
      path: 'D:\\brief.pdf',
      arrayBuffer,
    } as unknown as File & { path: string };
    const clipboard = { files: [file] } as unknown as DataTransfer;
    await expect(clipboardFilesToWorkspaceBlobs(clipboard)).resolves.toEqual({
      files: [{ path: 'D:\\brief.pdf', name: 'brief.pdf', size: 100_000_000 }],
      blobs: [],
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('ignores Windows clipboard File.path and still pastes as a blob', async () => {
    const file = {
      name: 'image.png',
      size: 3,
      type: 'image/png',
      path: 'C:\\Users\\user\\AppData\\Local\\Temp\\ocrA1B2.png',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File & { path: string };
    const clipboard = { files: [file] } as unknown as DataTransfer;
    vi.stubGlobal('btoa', (input: string) => Buffer.from(input, 'binary').toString('base64'));

    await expect(clipboardFilesToWorkspaceBlobs(clipboard)).resolves.toEqual({
      files: [],
      blobs: [{ name: 'image.png', mediaType: 'image/png', dataBase64: 'AQID' }],
    });
  });
});
