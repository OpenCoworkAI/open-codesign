import type { WorkspaceImportBlobInput, WorkspaceImportFileInput } from '../../../preload';

type FileWithPath = File & { path?: string };

const MAX_CLIPBOARD_IMAGE_BLOB_BYTES = 10_000_000;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function dataTransferFilesToWorkspaceFiles(
  dataTransfer: DataTransfer,
): WorkspaceImportFileInput[] {
  const out: WorkspaceImportFileInput[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    const localPath = (file as FileWithPath).path;
    if (typeof localPath !== 'string' || localPath.length === 0) continue;
    out.push({ path: localPath, name: file.name, size: file.size });
  }
  return out;
}

/**
 * Read small clipboard image bytes before temporary files disappear. Larger files
 * keep the main-process copy path so large documents do not load in the renderer.
 */
export async function clipboardFilesToWorkspaceBlobs(
  dataTransfer: DataTransfer,
): Promise<{ files: WorkspaceImportFileInput[]; blobs: WorkspaceImportBlobInput[] }> {
  return filesToWorkspaceImport(Array.from(dataTransfer.files), { preferBlob: true });
}

export async function fileListToWorkspaceImport(
  fileList: FileList | readonly File[],
): Promise<{ files: WorkspaceImportFileInput[]; blobs: WorkspaceImportBlobInput[] }> {
  return filesToWorkspaceImport(Array.from(fileList));
}

async function filesToWorkspaceImport(
  sourceFiles: readonly File[],
  opts: { preferBlob?: boolean } = {},
): Promise<{ files: WorkspaceImportFileInput[]; blobs: WorkspaceImportBlobInput[] }> {
  const files: WorkspaceImportFileInput[] = [];
  const blobs: WorkspaceImportBlobInput[] = [];
  for (const file of sourceFiles) {
    const localPath = (file as FileWithPath).path;
    const preferImageBlob =
      opts.preferBlob === true &&
      file.size <= MAX_CLIPBOARD_IMAGE_BLOB_BYTES &&
      (file.type?.startsWith('image/') ||
        /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name));
    if (!preferImageBlob && typeof localPath === 'string' && localPath.length > 0) {
      files.push({ path: localPath, name: file.name, size: file.size });
      continue;
    }
    blobs.push({
      // Preserve an empty name so the importer can choose the extension from mediaType.
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
    });
  }
  return { files, blobs };
}
