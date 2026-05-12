import type { WorkspaceImportBlobInput, WorkspaceImportFileInput } from '../../../preload';

type FileWithPath = File & { path?: string };

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

export async function clipboardFilesToWorkspaceBlobs(
  dataTransfer: DataTransfer,
): Promise<{ files: WorkspaceImportFileInput[]; blobs: WorkspaceImportBlobInput[] }> {
  return filesToWorkspaceImport(Array.from(dataTransfer.files));
}

export async function fileListToWorkspaceImport(
  fileList: FileList | readonly File[],
): Promise<{ files: WorkspaceImportFileInput[]; blobs: WorkspaceImportBlobInput[] }> {
  return filesToWorkspaceImport(Array.from(fileList));
}

async function filesToWorkspaceImport(
  sourceFiles: readonly File[],
): Promise<{ files: WorkspaceImportFileInput[]; blobs: WorkspaceImportBlobInput[] }> {
  const files: WorkspaceImportFileInput[] = [];
  const blobs: WorkspaceImportBlobInput[] = [];
  for (const file of sourceFiles) {
    const localPath = (file as FileWithPath).path;
    if (typeof localPath === 'string' && localPath.length > 0) {
      files.push({ path: localPath, name: file.name, size: file.size });
      continue;
    }
    blobs.push({
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
    });
  }
  return { files, blobs };
}
