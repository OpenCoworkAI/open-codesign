import JSZip from 'jszip';

/**
 * Plain text from the Office Open XML formats (DOCX, PPTX, XLSX). Archives are read as text
 * and nothing in them is executed. Every limit comes from the caller, so each caller keeps its
 * own budget: the Files tab preview and the prompt attachment do not share numbers.
 */

export type OoxmlFormat = 'docx' | 'pptx' | 'xlsx';

export interface DocumentTextLimits {
  /** Slides or sheets read. */
  maxSections: number;
  /** Paragraphs read from a DOCX. */
  maxParagraphs: number;
  /** Text lines read from one slide. */
  maxLinesPerSlide: number;
  /** Rows read from one sheet. */
  maxRowsPerSheet: number;
  /** Cells read from one row. */
  maxCellsPerRow: number;
  /** Characters kept of one line. */
  maxLineChars: number;
}

export interface DocumentTextSection {
  title: string;
  lines: string[];
}

export interface DocumentTextStat {
  label: string;
  value: string;
}

export interface DocumentText {
  title: string | null;
  stats: DocumentTextStat[];
  sections: DocumentTextSection[];
}

/** Metadata lines (title, author, counts) are short whatever the caller's line limit is. */
const METADATA_LINE_CHARS = 260;
/** Entries of the shared-strings table kept, which bounds the table, not what is shown. */
const SHARED_STRINGS_LIMIT = 10_000;

const XML_ENTITY_REPLACEMENTS = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
]);

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

export function cleanLine(value: string, maxChars: number): string {
  const normalized = xmlTextContent(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

export function compactLines(
  values: Iterable<string>,
  maxLines: number,
  maxChars: number,
): string[] {
  const out: string[] = [];
  for (const value of values) {
    const line = cleanLine(value, maxChars);
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
  const text = cleanLine(value, METADATA_LINE_CHARS);
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

function appStats(coreXml: string | null, appXml: string | null): DocumentTextStat[] {
  const stats: DocumentTextStat[] = [];
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

export function section(title: string, lines: string[]): DocumentTextSection | null {
  if (lines.length === 0) return null;
  return { title, lines };
}

function parseDocx(documentXml: string | null, limits: DocumentTextLimits): DocumentTextSection[] {
  if (documentXml === null) return [];
  const paragraphs = localElementContents(documentXml, 'p');
  const lines =
    paragraphs.length > 0
      ? compactLines(
          paragraphs.map((paragraph) => textRuns(paragraph).join('')),
          limits.maxParagraphs,
          limits.maxLineChars,
        )
      : compactLines(textRuns(documentXml), limits.maxParagraphs, limits.maxLineChars);
  const item = section('Document', lines);
  return item === null ? [] : [item];
}

async function parsePptx(zip: JSZip, limits: DocumentTextLimits): Promise<DocumentTextSection[]> {
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .slice(0, limits.maxSections);
  const sections: DocumentTextSection[] = [];
  for (const name of slideNames) {
    const xml = await readZipText(zip, name);
    if (xml === null) continue;
    const lines = compactLines(textRuns(xml), limits.maxLinesPerSlide, limits.maxLineChars);
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

function parseSharedStrings(sharedStringsXml: string | null, limits: DocumentTextLimits): string[] {
  if (sharedStringsXml === null) return [];
  const items = localElementContents(sharedStringsXml, 'si');
  if (items.length === 0)
    return compactLines(textRuns(sharedStringsXml), SHARED_STRINGS_LIMIT, limits.maxLineChars);
  return items
    .map((item) => cleanLine(textRuns(item).join(''), limits.maxLineChars))
    .filter((line) => line.length > 0);
}

function parseWorksheetRows(
  xml: string,
  sharedStrings: string[],
  limits: DocumentTextLimits,
): string[] {
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
        value = cleanLine(textRuns(body).join(''), limits.maxLineChars);
      } else {
        value = valueText;
      }
      if (value !== null && value.trim().length > 0) cells.push(value.trim());
      if (cells.length >= limits.maxCellsPerRow) break;
    }
    if (cells.length > 0) out.push(cells.join(' · '));
    if (out.length >= limits.maxRowsPerSheet) break;
  }
  return out;
}

async function parseXlsx(zip: JSZip, limits: DocumentTextLimits): Promise<DocumentTextSection[]> {
  const [workbookXml, sharedStringsXml] = await Promise.all([
    readZipText(zip, 'xl/workbook.xml'),
    readZipText(zip, 'xl/sharedStrings.xml'),
  ]);
  const sheetNames = parseSheetNames(workbookXml);
  const sharedStrings = parseSharedStrings(sharedStringsXml, limits);
  const worksheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b))
    .slice(0, limits.maxSections);
  const sections: DocumentTextSection[] = [];
  for (const [index, name] of worksheetNames.entries()) {
    const xml = await readZipText(zip, name);
    if (xml === null) continue;
    const lines = parseWorksheetRows(xml, sharedStrings, limits);
    const item = section(sheetNames[index] ?? `Sheet ${index + 1}`, lines);
    if (item !== null) sections.push(item);
  }
  if (sections.length === 0 && sharedStrings.length > 0) {
    const item = section(
      'Workbook',
      compactLines(sharedStrings, limits.maxRowsPerSheet, limits.maxLineChars),
    );
    if (item !== null) sections.push(item);
  }
  return sections;
}

function sheetNumber(name: string): number {
  const match = /sheet(\d+)\.xml$/u.exec(name);
  return match?.[1] === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(match[1], 10);
}

/** Reads the text of a DOCX, PPTX or XLSX. Rejects when the bytes are not a zip archive. */
export async function readOoxmlText(
  bytes: Uint8Array,
  format: OoxmlFormat,
  limits: DocumentTextLimits,
): Promise<DocumentText> {
  const zip = await JSZip.loadAsync(bytes);
  const [coreXml, appXml] = await Promise.all([
    readZipText(zip, 'docProps/core.xml'),
    readZipText(zip, 'docProps/app.xml'),
  ]);
  const stats = appStats(coreXml, appXml);
  const title = firstLocalElementText(coreXml, 'title');
  if (format === 'docx') {
    const sections = parseDocx(await readZipText(zip, 'word/document.xml'), limits);
    return { title, stats, sections };
  }
  if (format === 'pptx') return { title, stats, sections: await parsePptx(zip, limits) };
  return { title, stats, sections: await parseXlsx(zip, limits) };
}
