import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { nativeImage } from './electron-runtime';

const execFile = promisify(execFileCb);

const MAX_DOCUMENT_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_SECTION_COUNT = 16;
const MAX_LINES_PER_SECTION = 24;
const MAX_LINE_CHARS = 260;
const THUMBNAIL_WIDTH = 720;
const THUMBNAIL_HEIGHT = 900;
const THUMBNAIL_LINE_CHARS = 34;

export type WorkspaceDocumentPreviewFormat =
  | 'doc'
  | 'docx'
  | 'ppt'
  | 'pptx'
  | 'rtf'
  | 'xls'
  | 'xlsx'
  | 'unknown';

export interface WorkspaceDocumentPreviewStat {
  label: string;
  value: string;
}

export interface WorkspaceDocumentPreviewSection {
  title: string;
  lines: string[];
}

export interface WorkspaceDocumentPreviewResult {
  schemaVersion: 1;
  path: string;
  fileName: string;
  format: WorkspaceDocumentPreviewFormat;
  title: string;
  size: number;
  updatedAt: string;
  stats: WorkspaceDocumentPreviewStat[];
  sections: WorkspaceDocumentPreviewSection[];
  thumbnailDataUrl?: string;
}

export interface WorkspaceDocumentThumbnailResult {
  schemaVersion: 1;
  path: string;
  thumbnailDataUrl: string | null;
}

interface WorkspaceDocumentPreviewInput {
  absPath: string;
  relPath: string;
  generateThumbnail?: ((absPath: string) => Promise<string | null>) | undefined;
}

interface ParsedDocumentPreview {
  title: string | null;
  stats: WorkspaceDocumentPreviewStat[];
  sections: WorkspaceDocumentPreviewSection[];
}

interface SemanticThumbnailInput {
  fileName: string;
  format: WorkspaceDocumentPreviewFormat;
  title: string;
  stats: WorkspaceDocumentPreviewStat[];
  sections: WorkspaceDocumentPreviewSection[];
}

const XML_ENTITY_REPLACEMENTS = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
]);

function formatFromPath(filePath: string): WorkspaceDocumentPreviewFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.doc') return 'doc';
  if (ext === '.docx') return 'docx';
  if (ext === '.ppt') return 'ppt';
  if (ext === '.pptx') return 'pptx';
  if (ext === '.rtf') return 'rtf';
  if (ext === '.xls') return 'xls';
  if (ext === '.xlsx') return 'xlsx';
  return 'unknown';
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => XML_ENTITY_REPLACEMENTS.get(name) ?? match);
}

function xmlTextContent(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]*>/g, ''));
}

function cleanLine(value: string): string {
  const normalized = xmlTextContent(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_LINE_CHARS) return normalized;
  return `${normalized.slice(0, MAX_LINE_CHARS - 3)}...`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.split(/\s+/u).filter((part) => part.length > 0);
  const lines: string[] = [];
  let current = '';
  if (words.length <= 1) {
    const chars = Array.from(value);
    for (let i = 0; i < chars.length && lines.length < maxLines; i += maxChars) {
      lines.push(chars.slice(i, i + maxChars).join(''));
    }
    return lines;
  }
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (Array.from(candidate).length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current.length > 0 && lines.length < maxLines) lines.push(current);
  return lines;
}

function textElement(
  value: string,
  x: number,
  y: number,
  opts: { size: number; weight?: number; color?: string; maxChars?: number; maxLines?: number },
): string {
  const maxChars = opts.maxChars ?? THUMBNAIL_LINE_CHARS;
  const maxLines = opts.maxLines ?? 1;
  const lines = wrapText(value, maxChars, maxLines);
  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : Math.round(opts.size * 1.32);
      return `<tspan x="${x}" dy="${dy}">${escapeSvgText(line)}</tspan>`;
    })
    .join('');
  return `<text x="${x}" y="${y}" fill="${opts.color ?? '#1f2933'}" font-size="${opts.size}" font-weight="${opts.weight ?? 400}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${tspans}</text>`;
}

function firstLinesForThumbnail(sections: WorkspaceDocumentPreviewSection[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    for (const line of section.lines) {
      out.push(line);
      if (out.length >= 7) return out;
    }
  }
  return out;
}

function createSemanticDocumentThumbnailDataUrl(input: SemanticThumbnailInput): string {
  const format = input.format === 'unknown' ? 'FILE' : input.format.toUpperCase();
  const statText = input.stats
    .slice(0, 3)
    .map((stat) => `${stat.label}: ${stat.value}`)
    .join('  ');
  const lines = firstLinesForThumbnail(input.sections);
  const body =
    lines.length > 0
      ? lines
          .slice(0, 5)
          .flatMap((line) => wrapText(line, 56, 2))
          .slice(0, 8)
      : [input.fileName];
  const bodyText = body
    .map(
      (line, index) =>
        `<text x="74" y="${392 + index * 44}" fill="#3f4b57" font-size="25" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeSvgText(line)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}">
  <rect width="720" height="900" rx="42" fill="#f8f5ee"/>
  <rect x="38" y="38" width="644" height="824" rx="30" fill="#fffdf8" stroke="#d8d0bf" stroke-width="2"/>
  <rect x="74" y="82" width="144" height="50" rx="16" fill="#f05d3b"/>
  <text x="102" y="116" fill="#fffaf2" font-size="24" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeSvgText(format)}</text>
  ${textElement(input.title, 74, 205, { size: 46, weight: 700, maxChars: 20, maxLines: 3 })}
  <text x="74" y="324" fill="#7b8792" font-size="22" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeSvgText(statText || input.fileName)}</text>
  <line x1="74" y1="358" x2="646" y2="358" stroke="#e6dfd2" stroke-width="2"/>
  ${bodyText}
  <rect x="74" y="780" width="572" height="2" fill="#e6dfd2"/>
  <text x="74" y="825" fill="#9aa3ad" font-size="22" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeSvgText(input.fileName)}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function compactLines(values: Iterable<string>, maxLines = MAX_LINES_PER_SECTION): string[] {
  const out: string[] = [];
  for (const value of values) {
    const line = cleanLine(value);
    if (line.length === 0) continue;
    out.push(line);
    if (out.length >= maxLines) break;
  }
  return out;
}

function localElementContents(xml: string, localName: string): string[] {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${localName}>`,
    'gi',
  );
  const out: string[] = [];
  for (const match of xml.matchAll(re)) {
    const content = match[1];
    if (content !== undefined) out.push(content);
  }
  return out;
}

function firstLocalElementText(xml: string | null, localName: string): string | null {
  if (xml === null) return null;
  const value = localElementContents(xml, localName)[0];
  if (value === undefined) return null;
  const text = cleanLine(value);
  return text.length > 0 ? text : null;
}

function textRuns(xml: string): string[] {
  return localElementContents(xml, 't').map(xmlTextContent);
}

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = re.exec(attrs);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : decodeXmlEntities(value);
}

async function readZipText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  if (file === null) return null;
  return file.async('string');
}

function appStats(coreXml: string | null, appXml: string | null): WorkspaceDocumentPreviewStat[] {
  const stats: WorkspaceDocumentPreviewStat[] = [];
  for (const [label, tag] of [
    ['Pages', 'Pages'],
    ['Slides', 'Slides'],
    ['Worksheets', 'Worksheets'],
    ['Words', 'Words'],
  ] as const) {
    const value = firstLocalElementText(appXml, tag);
    if (value !== null) stats.push({ label, value });
  }
  const author = firstLocalElementText(coreXml, 'creator');
  if (author !== null) stats.push({ label: 'Author', value: author });
  return stats;
}

function firstPreviewLine(sections: WorkspaceDocumentPreviewSection[]): string | null {
  for (const section of sections) {
    const line = section.lines[0];
    if (line !== undefined) return line;
  }
  return null;
}

function section(title: string, lines: string[]): WorkspaceDocumentPreviewSection | null {
  if (lines.length === 0) return null;
  return { title, lines };
}

function parseDocx(documentXml: string | null): WorkspaceDocumentPreviewSection[] {
  if (documentXml === null) return [];
  const paragraphs = localElementContents(documentXml, 'p');
  const lines =
    paragraphs.length > 0
      ? compactLines(paragraphs.map((paragraph) => textRuns(paragraph).join('')))
      : compactLines(textRuns(documentXml));
  const previewSection = section('Document', lines);
  return previewSection === null ? [] : [previewSection];
}

async function parsePptx(zip: JSZip): Promise<WorkspaceDocumentPreviewSection[]> {
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .slice(0, MAX_SECTION_COUNT);
  const sections: WorkspaceDocumentPreviewSection[] = [];
  for (const name of slideNames) {
    const xml = await readZipText(zip, name);
    if (xml === null) continue;
    const lines = compactLines(textRuns(xml), 12);
    const item = section(`Slide ${slideNumber(name)}`, lines);
    if (item !== null) sections.push(item);
  }
  return sections;
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/u.exec(name);
  return match?.[1] === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(match[1], 10);
}

function parseSheetNames(workbookXml: string | null): string[] {
  if (workbookXml === null) return [];
  const out: string[] = [];
  const re = /<sheet\b([^>]*)\/?>/gi;
  for (const match of workbookXml.matchAll(re)) {
    const attrs = match[1];
    if (attrs === undefined) continue;
    const name = attrValue(attrs, 'name');
    if (name !== null && name.trim().length > 0) out.push(name.trim());
  }
  return out;
}

function parseSharedStrings(sharedStringsXml: string | null): string[] {
  if (sharedStringsXml === null) return [];
  const items = localElementContents(sharedStringsXml, 'si');
  if (items.length === 0) return compactLines(textRuns(sharedStringsXml), 10_000);
  return items.map((item) => cleanLine(textRuns(item).join(''))).filter((line) => line.length > 0);
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rows = localElementContents(xml, 'row');
  const out: string[] = [];
  for (const row of rows) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    for (const cellMatch of row.matchAll(cellRe)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const type = attrValue(attrs, 't');
      const valueText = firstLocalElementText(body, 'v');
      let value: string | null = null;
      if (type === 's' && valueText !== null) {
        value = sharedStrings[Number.parseInt(valueText, 10)] ?? valueText;
      } else if (type === 'inlineStr') {
        value = cleanLine(textRuns(body).join(''));
      } else {
        value = valueText;
      }
      if (value !== null && value.trim().length > 0) cells.push(value.trim());
      if (cells.length >= 8) break;
    }
    if (cells.length > 0) out.push(cells.join(' · '));
    if (out.length >= MAX_LINES_PER_SECTION) break;
  }
  return out;
}

async function parseXlsx(zip: JSZip): Promise<WorkspaceDocumentPreviewSection[]> {
  const [workbookXml, sharedStringsXml] = await Promise.all([
    readZipText(zip, 'xl/workbook.xml'),
    readZipText(zip, 'xl/sharedStrings.xml'),
  ]);
  const sheetNames = parseSheetNames(workbookXml);
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const worksheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b))
    .slice(0, MAX_SECTION_COUNT);
  const sections: WorkspaceDocumentPreviewSection[] = [];
  for (const [index, name] of worksheetNames.entries()) {
    const xml = await readZipText(zip, name);
    if (xml === null) continue;
    const lines = parseWorksheetRows(xml, sharedStrings);
    const item = section(sheetNames[index] ?? `Sheet ${index + 1}`, lines);
    if (item !== null) sections.push(item);
  }
  if (sections.length === 0 && sharedStrings.length > 0) {
    const item = section('Workbook', compactLines(sharedStrings));
    if (item !== null) sections.push(item);
  }
  return sections;
}

function sheetNumber(name: string): number {
  const match = /sheet(\d+)\.xml$/u.exec(name);
  return match?.[1] === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(match[1], 10);
}

async function parseOpenXmlDocument(
  absPath: string,
  format: WorkspaceDocumentPreviewFormat,
): Promise<ParsedDocumentPreview> {
  try {
    const bytes = await readFile(absPath);
    const zip = await JSZip.loadAsync(bytes);
    const [coreXml, appXml] = await Promise.all([
      readZipText(zip, 'docProps/core.xml'),
      readZipText(zip, 'docProps/app.xml'),
    ]);
    const stats = appStats(coreXml, appXml);
    const coreTitle = firstLocalElementText(coreXml, 'title');
    if (format === 'docx') {
      const documentXml = await readZipText(zip, 'word/document.xml');
      const sections = parseDocx(documentXml);
      return { title: coreTitle, stats, sections };
    }
    if (format === 'pptx') {
      const sections = await parsePptx(zip);
      return { title: coreTitle, stats, sections };
    }
    if (format === 'xlsx') {
      const sections = await parseXlsx(zip);
      return { title: coreTitle, stats, sections };
    }
  } catch {
    // Invalid or older binary Office files still get metadata and, on macOS,
    // a Quick Look thumbnail. The renderer will show a graceful empty state.
  }
  return { title: null, stats: [], sections: [] };
}

async function parseRtfDocument(absPath: string): Promise<ParsedDocumentPreview> {
  try {
    const bytes = await readFile(absPath);
    const raw = bytes.toString('utf8', 0, Math.min(bytes.length, 256 * 1024));
    const stripped = raw
      .replace(/\\'[0-9a-f]{2}/gi, ' ')
      .replace(/\\[a-z]+-?\d* ?/gi, ' ')
      .replace(/[{}]/g, ' ');
    const lines = compactLines(stripped.split(/\\par|\n/u));
    const previewSection = section('Document', lines);
    return { title: null, stats: [], sections: previewSection === null ? [] : [previewSection] };
  } catch {
    return { title: null, stats: [], sections: [] };
  }
}

async function parseDocument(
  absPath: string,
  format: WorkspaceDocumentPreviewFormat,
  size: number,
): Promise<ParsedDocumentPreview> {
  if (size > MAX_DOCUMENT_PREVIEW_BYTES) return { title: null, stats: [], sections: [] };
  if (format === 'docx' || format === 'pptx' || format === 'xlsx') {
    return parseOpenXmlDocument(absPath, format);
  }
  if (format === 'rtf') return parseRtfDocument(absPath);
  return { title: null, stats: [], sections: [] };
}

async function findGeneratedQuickLookPng(outDir: string): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const files = await readdir(outDir);
    const png = files.find((file) => file.toLowerCase().endsWith('.png'));
    if (png !== undefined) return path.join(outDir, png);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function generateQuickLookThumbnailDataUrl(absPath: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const outDir = await mkdtemp(path.join(tmpdir(), 'codesign-ql-'));
  try {
    await execFile('qlmanage', ['-t', '-s', '1000', '-o', outDir, absPath], {
      timeout: 8_000,
      windowsHide: true,
    });
    const pngPath = await findGeneratedQuickLookPng(outDir);
    if (pngPath === null) return null;
    const bytes = await readFile(pngPath);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

export async function generateNativeThumbnailDataUrl(absPath: string): Promise<string | null> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
  const maybeNativeImage = nativeImage as typeof nativeImage | undefined;
  if (typeof maybeNativeImage?.createThumbnailFromPath !== 'function') return null;
  try {
    const thumbnail = await maybeNativeImage.createThumbnailFromPath(absPath, {
      width: 1000,
      height: 1000,
    });
    if (thumbnail.isEmpty()) return null;
    const bytes = thumbnail.toPNG();
    if (bytes.length === 0) return null;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function generatePlatformThumbnailDataUrl(absPath: string): Promise<string | null> {
  return (
    (await generateNativeThumbnailDataUrl(absPath)) ?? generateQuickLookThumbnailDataUrl(absPath)
  );
}

export async function createWorkspaceDocumentPreview(
  input: WorkspaceDocumentPreviewInput,
): Promise<WorkspaceDocumentPreviewResult> {
  const fileStat = await stat(input.absPath);
  if (!fileStat.isFile()) {
    throw new Error(`not a file: ${input.relPath}`);
  }
  const format = formatFromPath(input.relPath);
  const fileName = path.basename(input.relPath);
  const generateThumbnail = input.generateThumbnail ?? (async () => null);
  const [parsed, thumbnailDataUrl] = await Promise.all([
    parseDocument(input.absPath, format, fileStat.size),
    generateThumbnail(input.absPath),
  ]);
  const title = parsed.title ?? firstPreviewLine(parsed.sections) ?? fileName;
  const semanticThumbnailDataUrl = createSemanticDocumentThumbnailDataUrl({
    fileName,
    format,
    title,
    stats: parsed.stats,
    sections: parsed.sections,
  });
  const base = {
    schemaVersion: 1,
    path: input.relPath,
    fileName,
    format,
    title,
    size: fileStat.size,
    updatedAt: fileStat.mtime.toISOString(),
    stats: parsed.stats,
    sections: parsed.sections,
    thumbnailDataUrl: thumbnailDataUrl ?? semanticThumbnailDataUrl,
  } satisfies WorkspaceDocumentPreviewResult;
  return base;
}

export async function createWorkspaceDocumentThumbnail(input: {
  absPath: string;
  relPath: string;
}): Promise<WorkspaceDocumentThumbnailResult> {
  const platformThumbnail = await generatePlatformThumbnailDataUrl(input.absPath);
  if (platformThumbnail !== null) {
    return { schemaVersion: 1, path: input.relPath, thumbnailDataUrl: platformThumbnail };
  }
  const preview = await createWorkspaceDocumentPreview({
    absPath: input.absPath,
    relPath: input.relPath,
    generateThumbnail: async () => null,
  });
  return {
    schemaVersion: 1,
    path: input.relPath,
    thumbnailDataUrl: preview.thumbnailDataUrl ?? null,
  };
}
