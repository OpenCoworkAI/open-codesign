import { replaceEditmodeBlock } from '@open-codesign/shared';
import {
  resolveWorkspacePreviewSource,
  type WorkspacePreviewRead,
  type WorkspacePreviewReadResult,
} from './workspace-source';

export type WorkspacePreviewWrite = (
  designId: string,
  path: string,
  content: string,
) => Promise<WorkspacePreviewReadResult>;

export interface PersistTweakTokensResult {
  content: string;
  path: string;
  wrote: boolean;
}

export async function resolveTweakWriteTarget(input: {
  designId: string;
  previewHtml: string;
  read?: WorkspacePreviewRead | undefined;
}): Promise<WorkspacePreviewReadResult> {
  if (!input.read) return { content: input.previewHtml, path: 'index.html' };
  const index = await input.read(input.designId, 'index.html');
  return await resolveWorkspacePreviewSource({
    designId: input.designId,
    source: index.content,
    path: index.path,
    read: input.read,
  });
}

export async function persistTweakTokensToWorkspace(input: {
  designId: string | null;
  previewHtml: string;
  tokens: Record<string, unknown>;
  read?: WorkspacePreviewRead | undefined;
  write?: WorkspacePreviewWrite | undefined;
}): Promise<PersistTweakTokensResult> {
  const fallbackContent = replaceEditmodeBlock(input.previewHtml, input.tokens);
  if (!input.designId || !input.write) {
    return { content: fallbackContent, path: 'index.html', wrote: false };
  }

  const target = await resolveTweakWriteTarget({
    designId: input.designId,
    previewHtml: input.previewHtml,
    read: input.read,
  });
  const nextContent = replaceEditmodeBlock(target.content, input.tokens);
  await input.write(input.designId, target.path, nextContent);
  return { content: nextContent, path: target.path, wrote: true };
}
