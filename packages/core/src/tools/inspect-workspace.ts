import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

export interface InspectWorkspaceFileInput {
  file: string;
  contents?: string | undefined;
}

export interface WorkspaceInspection {
  entryCandidates: string[];
  sourceFiles: string[];
  styleFiles: string[];
  designDocs: string[];
  referenceDocs: string[];
  assets: string[];
  totalFiles: number;
  truncated: boolean;
}

const InspectWorkspaceParams = Type.Object({});
const MAX_GROUP_ITEMS = 24;

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function limitGroup(values: string[]): { values: string[]; truncated: boolean } {
  const unique = sortedUnique(values);
  return {
    values: unique.slice(0, MAX_GROUP_ITEMS),
    truncated: unique.length > MAX_GROUP_ITEMS,
  };
}

function lowerPath(file: string): string {
  return file.replace(/\\/g, '/').toLowerCase();
}

function isDesignDoc(file: string): boolean {
  const lower = lowerPath(file);
  return lower === 'design.md' || lower.endsWith('/design.md') || lower === 'agents.md';
}

function isSourceFile(file: string): boolean {
  return /\.(?:jsx|tsx|html?|js|ts|mjs|cjs)$/i.test(file);
}

function isStyleFile(file: string): boolean {
  return /\.(?:css|scss|sass|less)$/i.test(file);
}

function isReferenceDoc(file: string): boolean {
  const lower = lowerPath(file);
  if (isDesignDoc(lower)) return false;
  return /\.(?:md|txt|json|ya?ml|toml|csv|pdf|docx?|pptx?|xlsx?|rtf)$/i.test(file);
}

function isAsset(file: string): boolean {
  return /\.(?:svg|png|jpe?g|webp|gif|avif|ico)$/i.test(file);
}

function entryScore(file: string): number {
  const lower = lowerPath(file);
  if (lower === 'app.jsx') return 100;
  if (lower === 'app.tsx') return 95;
  if (lower === 'index.html') return 90;
  if (lower.endsWith('/app.jsx') || lower.endsWith('/app.tsx')) return 70;
  if (lower.endsWith('/index.html')) return 65;
  if (/\.(?:jsx|tsx|html?)$/i.test(file)) return 10;
  return 0;
}

function entryCandidates(files: string[]): string[] {
  return files
    .map((file) => ({ file, score: entryScore(file) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, 'en'))
    .slice(0, 8)
    .map((entry) => entry.file);
}

export function inspectWorkspaceFiles(
  files: readonly InspectWorkspaceFileInput[],
): WorkspaceInspection {
  const paths = files.map((file) => file.file).filter((file) => file.trim().length > 0);
  const source = limitGroup(paths.filter(isSourceFile));
  const style = limitGroup(paths.filter(isStyleFile));
  const design = limitGroup(paths.filter(isDesignDoc));
  const reference = limitGroup(paths.filter(isReferenceDoc));
  const assets = limitGroup(paths.filter(isAsset));
  const entry = limitGroup(entryCandidates(paths));
  return {
    entryCandidates: entry.values,
    sourceFiles: source.values,
    styleFiles: style.values,
    designDocs: design.values,
    referenceDocs: reference.values,
    assets: assets.values,
    totalFiles: paths.length,
    truncated:
      entry.truncated ||
      source.truncated ||
      style.truncated ||
      design.truncated ||
      reference.truncated ||
      assets.truncated,
  };
}

export type InspectWorkspaceFn = () => Promise<WorkspaceInspection>;

function summarizeGroup(label: string, values: readonly string[]): string {
  return values.length > 0 ? `${label}: ${values.join(', ')}` : `${label}: none`;
}

export function summarizeWorkspaceInspection(result: WorkspaceInspection): string {
  return [
    `workspace inspection: ${result.totalFiles} file(s), ${result.entryCandidates.length} entry candidate(s), ${result.sourceFiles.length} source file(s), ${result.referenceDocs.length} reference doc(s), ${result.assets.length} asset(s), truncated: ${result.truncated ? 'yes' : 'no'}`,
    summarizeGroup('entry candidates', result.entryCandidates),
    summarizeGroup('source files', result.sourceFiles),
    summarizeGroup('style files', result.styleFiles),
    summarizeGroup('design docs', result.designDocs),
    summarizeGroup('reference docs', result.referenceDocs),
    summarizeGroup('assets', result.assets),
  ].join('\n');
}

export function makeInspectWorkspaceTool(
  inspectWorkspace: InspectWorkspaceFn,
): AgentTool<typeof InspectWorkspaceParams, WorkspaceInspection> {
  return {
    name: 'inspect_workspace',
    label: 'Inspect workspace',
    description:
      'Inspect the current design workspace and return a bounded inventory: entry candidates, source files, style files, DESIGN.md/AGENTS.md docs, reference docs, assets, total file count, and truncation status. Call before editing when the workspace already contains files or reference materials.',
    parameters: InspectWorkspaceParams,
    async execute(_toolCallId): Promise<AgentToolResult<WorkspaceInspection>> {
      const result = await inspectWorkspace();
      return {
        content: [
          {
            type: 'text',
            text: summarizeWorkspaceInspection(result),
          },
        ],
        details: result,
      };
    },
  };
}
