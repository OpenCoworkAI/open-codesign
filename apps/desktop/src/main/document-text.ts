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

/** Removes every `<...>`; a `<` with no closing `>` stays, as does everything after it. */
function stripTags(value: string): string {
  let out = '';
  let from = 0;
  while (from < value.length) {
    const open = value.indexOf('<', from);
    if (open === -1) break;
    const close = value.indexOf('>', open + 1);
    if (close === -1) break;
    out += value.slice(from, open);
    from = close + 1;
  }
  return out + value.slice(from);
}

function xmlTextContent(value: string): string {
  return decodeXmlEntities(stripTags(value));
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

interface XmlElement {
  /** The text of the opening tag after the element name, without a closing `/`. */
  attrs: string;
  content: string;
}

const isNameCode = (code: number): boolean =>
  (code >= 48 && code <= 58) || // 0-9 and ':'
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  code === 45 || // '-'
  code === 46 || // '.'
  code === 95; // '_'

/**
 * The outermost elements named `localName`, whatever their namespace prefix. One pass over the
 * tags, so the time is linear in the size of the XML whatever it contains. A self-closing tag
 * is an empty element; an element that is never closed is left out.
 */
function elements(xml: string, localName: string): XmlElement[] {
  const wanted = localName.toLowerCase();
  const out: XmlElement[] = [];
  let open: { attrs: string; contentStart: number } | null = null;
  let from = 0;
  while (true) {
    const lt = xml.indexOf('<', from);
    if (lt === -1) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) break;
    from = gt + 1;
    const closing = xml.charCodeAt(lt + 1) === 47; // '/'
    const nameStart = lt + (closing ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < gt && isNameCode(xml.charCodeAt(nameEnd))) nameEnd += 1;
    const qualified = xml.slice(nameStart, nameEnd);
    if (qualified.slice(qualified.lastIndexOf(':') + 1).toLowerCase() !== wanted) continue;
    if (closing) {
      if (open !== null) {
        out.push({ attrs: open.attrs, content: xml.slice(open.contentStart, lt) });
        open = null;
      }
    } else if (open === null) {
      const attrs = xml.slice(nameEnd, gt);
      if (attrs.endsWith('/')) out.push({ attrs: attrs.slice(0, -1), content: '' });
      else open = { attrs, contentStart: gt + 1 };
    }
  }
  return out;
}

function localElementContents(xml: string, localName: string): string[] {
  return elements(xml, localName).map((element) => element.content);
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
  for (const { attrs } of elements(workbookXml, 'sheet')) {
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
    for (const { attrs, content: body } of elements(row, 'c')) {
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
