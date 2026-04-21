import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import {
  STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  type StoredDesignSystem,
} from '@open-codesign/shared';

export const IGNORED_DESIGN_SYSTEM_DIRS = new Set([
  '.git',
  '.idea',
  '.next',
  '.turbo',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

export const DESIGN_SYSTEM_CANDIDATE_EXTS = new Set([
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
]);

const PRIORITY_PATTERNS = [
  /tailwind\.config/i,
  /tokens?/i,
  /theme/i,
  /brand/i,
  /palette/i,
  /typography/i,
  /global\.(css|scss|sass|less)$/i,
  /variables?\.(css|scss|sass|less)$/i,
];

const MAX_FILES = 160;
const MAX_SELECTED_FILES = 12;
const MAX_FILE_CHARS = 32_000;

interface CandidateFile {
  fullPath: string;
  relativePath: string;
  score: number;
}

export interface DesignSystemSourceFile {
  relativePath: string;
  content: string;
}

function pushUnique(target: string[], value: string, max: number): void {
  if (!value || target.includes(value) || target.length >= max) return;
  target.push(value);
}

function cleanValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/["'`,]/g, '')
    .trim();
}

export function scoreDesignSystemCandidate(relativePath: string): number {
  const fileName = basename(relativePath);
  let score = 1;
  for (const pattern of PRIORITY_PATTERNS) {
    if (pattern.test(relativePath) || pattern.test(fileName)) score += 20;
  }
  if (/\.(css|scss|sass|less)$/i.test(fileName)) score += 8;
  if (/tailwind/i.test(relativePath)) score += 8;
  if (/src\//i.test(relativePath)) score += 4;
  return score;
}

export function isDesignSystemCandidateFile(fileName: string): boolean {
  const extension = extname(fileName).toLowerCase();
  return DESIGN_SYSTEM_CANDIDATE_EXTS.has(extension) || /tailwind\.config/i.test(fileName);
}

async function collectCandidateFiles(
  rootPath: string,
  dirPath: string,
  files: CandidateFile[],
): Promise<void> {
  if (files.length >= MAX_FILES) return;

  let entries: Dirent<string>[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DESIGN_SYSTEM_DIRS.has(entry.name)) {
        await collectCandidateFiles(rootPath, fullPath, files);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isDesignSystemCandidateFile(entry.name)) continue;
    const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');
    files.push({ fullPath, relativePath, score: scoreDesignSystemCandidate(relativePath) });
  }
}

function collectCssVarValues(
  raw: string,
  colors: string[],
  spacing: string[],
  radius: string[],
  shadows: string[],
): void {
  for (const match of raw.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}{\n]+)/gi)) {
    const name = match[1]?.toLowerCase() ?? '';
    const value = cleanValue(match[2] ?? '');
    if (!value) continue;
    if (/color|accent|surface|text|brand|primary|secondary/.test(name))
      pushUnique(colors, value, 24);
    if (/space|spacing|gap|padding|margin/.test(name)) pushUnique(spacing, value, 16);
    if (/radius|rounded/.test(name)) pushUnique(radius, value, 16);
    if (/shadow/.test(name)) pushUnique(shadows, value, 16);
  }
}

function collectLooseValues(
  raw: string,
  colors: string[],
  fonts: string[],
  spacing: string[],
  radius: string[],
  shadows: string[],
): void {
  for (const match of raw.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)) {
    pushUnique(colors, cleanValue(match[0] ?? ''), 24);
  }

  for (const match of raw.matchAll(/(?:font-family|fontFamily)[^:=]*[:=]\s*([^\n;]+)/gi)) {
    const value = cleanValue(match[1] ?? '');
    for (const part of value.split(',')) pushUnique(fonts, cleanValue(part), 16);
  }

  for (const match of raw.matchAll(
    /(?:spacing|space|gap|padding|margin)[^:=\n]*[:=]\s*([^\n,;]+)/gi,
  )) {
    pushUnique(spacing, cleanValue(match[1] ?? ''), 16);
  }

  for (const match of raw.matchAll(/(?:radius|rounded|borderRadius)[^:=\n]*[:=]\s*([^\n,;]+)/gi)) {
    pushUnique(radius, cleanValue(match[1] ?? ''), 16);
  }

  for (const match of raw.matchAll(/(?:shadow|boxShadow)[^:=\n]*[:=]\s*([^\n,;]+)/gi)) {
    pushUnique(shadows, cleanValue(match[1] ?? ''), 16);
  }
}

function buildSummary(
  snapshot: Omit<StoredDesignSystem, 'schemaVersion' | 'summary' | 'extractedAt'>,
): string {
  const repoLabel = basename(snapshot.rootPath);
  const parts = [
    `Scanned ${snapshot.sourceFiles.length} likely design-system files under ${repoLabel}.`,
  ];
  if (snapshot.colors.length > 0)
    parts.push(`Color language: ${snapshot.colors.slice(0, 5).join(', ')}.`);
  if (snapshot.fonts.length > 0)
    parts.push(`Typography: ${snapshot.fonts.slice(0, 4).join(', ')}.`);
  if (snapshot.spacing.length > 0)
    parts.push(`Spacing cues: ${snapshot.spacing.slice(0, 4).join(', ')}.`);
  if (snapshot.radius.length > 0)
    parts.push(`Corner radius cues: ${snapshot.radius.slice(0, 4).join(', ')}.`);
  if (snapshot.shadows.length > 0)
    parts.push(`Shadow cues: ${snapshot.shadows.slice(0, 4).join(', ')}.`);
  if (parts.length === 1) {
    parts.push(
      'No strong structured tokens were extracted, so lean on the referenced styling files and keep the output conservative and cohesive.',
    );
  }
  return parts.join(' ');
}

export function buildDesignSystemSnapshot(
  rootPath: string,
  files: DesignSystemSourceFile[],
  extra: Partial<
    Pick<StoredDesignSystem, 'sourceKind' | 'sshProfileId' | 'sshHost' | 'sshPort' | 'sshUsername'>
  > = {},
): StoredDesignSystem {
  const colors: string[] = [];
  const fonts: string[] = [];
  const spacing: string[] = [];
  const radius: string[] = [];
  const shadows: string[] = [];

  for (const file of files) {
    const snippet = file.content.slice(0, MAX_FILE_CHARS);
    collectCssVarValues(snippet, colors, spacing, radius, shadows);
    collectLooseValues(snippet, colors, fonts, spacing, radius, shadows);
  }

  const baseSnapshot = {
    rootPath,
    sourceKind: extra.sourceKind ?? 'local',
    ...(extra.sshProfileId !== undefined ? { sshProfileId: extra.sshProfileId } : {}),
    ...(extra.sshHost !== undefined ? { sshHost: extra.sshHost } : {}),
    ...(extra.sshPort !== undefined ? { sshPort: extra.sshPort } : {}),
    ...(extra.sshUsername !== undefined ? { sshUsername: extra.sshUsername } : {}),
    sourceFiles: files.map((file) => file.relativePath),
    colors,
    fonts,
    spacing,
    radius,
    shadows,
  };

  return {
    schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
    ...baseSnapshot,
    summary: buildSummary(baseSnapshot),
    extractedAt: new Date().toISOString(),
  };
}

export async function scanDesignSystem(rootPath: string): Promise<StoredDesignSystem> {
  const candidates: CandidateFile[] = [];
  await collectCandidateFiles(rootPath, rootPath, candidates);

  const selected = candidates
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
    .slice(0, MAX_SELECTED_FILES);

  const files: DesignSystemSourceFile[] = [];
  for (const file of selected) {
    try {
      files.push({
        relativePath: file.relativePath,
        content: await readFile(file.fullPath, 'utf8'),
      });
    } catch {}
  }

  return buildDesignSystemSnapshot(rootPath, files);
}
