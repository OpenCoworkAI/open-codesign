import {
  findArtifactSourceReference,
  resolveArtifactSourceReferencePath,
} from '@open-codesign/runtime';

export interface WorkspacePreviewReadResult {
  content: string;
  path: string;
}

export type WorkspacePreviewRead = (
  designId: string,
  path: string,
) => Promise<WorkspacePreviewReadResult>;

export function hasWorkspaceSourceReference(source: string, path = 'index.html'): boolean {
  return resolveReferencedWorkspacePreviewPath(source, path) !== null;
}

function looksLikeJsxModule(source: string): boolean {
  return (
    /\bReactDOM\.createRoot\s*\(/.test(source) ||
    /EDITMODE-BEGIN/.test(source) ||
    /(?:^|\n)\s*(?:function|const|let)\s+_?App\b/.test(source)
  );
}

export function resolveReferencedWorkspacePreviewPath(source: string, path: string): string | null {
  const lower = path.toLowerCase();
  if (!lower.endsWith('.html') && !lower.endsWith('.htm')) return null;
  if (looksLikeJsxModule(source)) return null;
  const reference = findArtifactSourceReference(source);
  return reference === null ? null : resolveArtifactSourceReferencePath(path, reference);
}

export async function readWorkspacePreviewSource(input: {
  designId: string;
  path: string;
  read: WorkspacePreviewRead;
}): Promise<WorkspacePreviewReadResult> {
  const result = await input.read(input.designId, input.path);
  return resolveWorkspacePreviewSource({
    designId: input.designId,
    source: result.content,
    path: result.path,
    read: input.read,
  });
}

export async function resolveWorkspacePreviewSource(input: {
  designId: string;
  source: string;
  path?: string | undefined;
  read?: WorkspacePreviewRead | undefined;
  requireReferencedSource?: boolean | undefined;
}): Promise<WorkspacePreviewReadResult> {
  const path = input.path ?? 'index.html';
  const referencedPath = resolveReferencedWorkspacePreviewPath(input.source, path);
  if (referencedPath === null) return { content: input.source, path };
  if (!input.read) {
    if (input.requireReferencedSource) {
      throw new Error(
        `Cannot resolve referenced preview source without files API: ${referencedPath}`,
      );
    }
    return { content: input.source, path };
  }
  let referenced: WorkspacePreviewReadResult;
  try {
    referenced = await input.read(input.designId, referencedPath);
  } catch (err) {
    if (input.requireReferencedSource) throw err;
    return { content: input.source, path };
  }
  if (referenced.content.trim().length === 0) return { content: input.source, path };
  return { content: referenced.content, path: referenced.path };
}
