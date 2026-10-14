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
  /**
   * Cells read from one row. Each cell is cut at `maxLineChars`, so a row can be up to
   * `maxCellsPerRow` × `maxLineChars` characters long.
   */
  maxCellsPerRow: number;
  /** Characters kept of one line. */
  maxLineChars: number;
  /** Bytes of XML read from the archive in all, after decompression. */
  maxUnpackedBytes: number;
  /** Say in the text what a limit left out, for a reader that cannot see the file. */
  markCuts: boolean;
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
  /** Slides or sheets past `maxSections`. */
  omittedSections: number;
  /** The part the format needs that the archive lacks, or null. */
  missingPart: string | null;
}

interface ParsedSections {
  sections: DocumentTextSection[];
  omittedSections: number;
  missingPart: string | null;
}

/** A row cut at `maxCellsPerRow` ends with this. */
export const CELLS_CUT_MARK = '…';

/** The line that says `count` more of something were left out by a limit. */
export function omittedMark(
  count: number,
  noun: 'paragraph' | 'row' | 'line' | 'slide' | 'sheet',
): string {
  return `(${count} more ${noun}${count === 1 ? '' : 's'} not shown)`;
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

/** Collapses whitespace and cuts to `maxChars`. The text is already decoded and is not read as XML again. */
export function cleanLine(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
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

/** Like compactLines, and counts the non-empty lines past `maxLines` that were left out. */
function collectLines(
  values: Iterable<string>,
  maxLines: number,
  maxChars: number,
): { lines: string[]; omitted: number } {
  const lines: string[] = [];
  let omitted = 0;
  for (const value of values) {
    const line = cleanLine(value, maxChars);
    if (line.length === 0) continue;
    if (lines.length < maxLines) lines.push(line);
    else omitted += 1;
  }
  return { lines, omitted };
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
  const text = cleanLine(xmlTextContent(value), METADATA_LINE_CHARS);
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

/** The archive's XML was larger than the caller's budget once decompressed. */
export class DocumentTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`The document holds more than ${limitBytes} bytes of XML once unpacked`);
    this.name = 'DocumentTooLargeError';
  }
}

/**
 * A zip archive whose parts are read as text under one budget. A part is streamed and the read
 * stops as soon as the budget is spent, so a few kilobytes that expand to gigabytes cost only
 * the budget.
 */
class OoxmlArchive {
  private remaining: number;

  constructor(
    private readonly zip: JSZip,
    private readonly limitBytes: number,
  ) {
    this.remaining = limitBytes;
  }

  names(): string[] {
    return Object.keys(this.zip.files);
  }

  text(name: string): Promise<string | null> {
    const file = this.zip.file(name);
    if (file === null) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      // JSZip returns its Node stream adapter, a Readable, which can be destroyed.
      const stream = file.nodeStream('nodebuffer') as NodeJS.ReadableStream & { destroy(): void };
      stream.on('data', (chunk: Buffer) => {
        this.remaining -= chunk.length;
        if (this.remaining < 0) {
          // Destroying the stream also stops the unpacking: on a 300 MB part the process burned
          // 4 ms of CPU afterwards, against 524 ms when the stream was left to finish.
          stream.destroy();
          reject(new DocumentTooLargeError(this.limitBytes));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  }
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

function parseDocx(documentXml: string | null, limits: DocumentTextLimits): ParsedSections {
  if (documentXml === null) {
    return { sections: [], omittedSections: 0, missingPart: 'word/document.xml' };
  }
  const paragraphs = localElementContents(documentXml, 'p');
  const { lines, omitted } = collectLines(
    paragraphs.length > 0
      ? paragraphs.map((paragraph) => textRuns(paragraph).join(''))
      : textRuns(documentXml),
    limits.maxParagraphs,
    limits.maxLineChars,
  );
  if (limits.markCuts && omitted > 0) lines.push(omittedMark(omitted, 'paragraph'));
  const item = section('Document', lines);
  return { sections: item === null ? [] : [item], omittedSections: 0, missingPart: null };
}

async function parsePptx(
  archive: OoxmlArchive,
  limits: DocumentTextLimits,
): Promise<ParsedSections> {
  const allSlides = archive
    .names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const sections: DocumentTextSection[] = [];
  for (const name of allSlides.slice(0, limits.maxSections)) {
    const xml = await archive.text(name);
    if (xml === null) continue;
    const { lines, omitted } = collectLines(
      textRuns(xml),
      limits.maxLinesPerSlide,
      limits.maxLineChars,
    );
    if (limits.markCuts && omitted > 0) lines.push(omittedMark(omitted, 'line'));
    const item = section(`Slide ${slideNumber(name)}`, lines);
    if (item !== null) sections.push(item);
  }
  return {
    sections,
    omittedSections: Math.max(0, allSlides.length - limits.maxSections),
    missingPart: allSlides.length === 0 ? 'ppt/slides/slide1.xml' : null,
  };
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

/** The first `maxCells` non-empty cells of a row, and whether the row has more. */
function rowCells(
  row: string,
  sharedStrings: string[],
  limits: DocumentTextLimits,
  maxCells: number,
): { cells: string[]; more: boolean } {
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
    if (value === null || value.trim().length === 0) continue;
    if (cells.length >= maxCells) return { cells, more: true };
    cells.push(value.trim());
  }
  return { cells, more: false };
}

function parseWorksheetRows(
  xml: string,
  sharedStrings: string[],
  limits: DocumentTextLimits,
): string[] {
  const lines: string[] = [];
  let omitted = 0;
  for (const row of localElementContents(xml, 'row')) {
    if (lines.length >= limits.maxRowsPerSheet) {
      if (!limits.markCuts) break;
      if (rowCells(row, sharedStrings, limits, 1).cells.length > 0) omitted += 1;
      continue;
    }
    const { cells, more } = rowCells(row, sharedStrings, limits, limits.maxCellsPerRow);
    if (cells.length === 0) continue;
    const cut = more && limits.markCuts ? ` · ${CELLS_CUT_MARK}` : '';
    lines.push(`${cells.join(' · ')}${cut}`);
  }
  if (omitted > 0) lines.push(omittedMark(omitted, 'row'));
  return lines;
}

async function parseXlsx(
  archive: OoxmlArchive,
  limits: DocumentTextLimits,
): Promise<ParsedSections> {
  const [workbookXml, sharedStringsXml] = await Promise.all([
    archive.text('xl/workbook.xml'),
    archive.text('xl/sharedStrings.xml'),
  ]);
  const sheetNames = parseSheetNames(workbookXml);
  const sharedStrings = parseSharedStrings(sharedStringsXml, limits);
  const allSheets = archive
    .names()
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));
  const sections: DocumentTextSection[] = [];
  for (const [index, name] of allSheets.slice(0, limits.maxSections).entries()) {
    const xml = await archive.text(name);
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
  return {
    sections,
    omittedSections: Math.max(0, allSheets.length - limits.maxSections),
    missingPart: workbookXml === null ? 'xl/workbook.xml' : null,
  };
}

function sheetNumber(name: string): number {
  const match = /sheet(\d+)\.xml$/u.exec(name);
  return match?.[1] === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(match[1], 10);
}

/**
 * Reads the text of a DOCX, PPTX or XLSX. Rejects when the bytes are not a zip archive, and
 * with a DocumentTooLargeError when the XML it holds is larger than the budget once unpacked.
 */
export async function readOoxmlText(
  bytes: Uint8Array,
  format: OoxmlFormat,
  limits: DocumentTextLimits,
): Promise<DocumentText> {
  const archive = new OoxmlArchive(await JSZip.loadAsync(bytes), limits.maxUnpackedBytes);
  const [coreXml, appXml] = await Promise.all([
    archive.text('docProps/core.xml'),
    archive.text('docProps/app.xml'),
  ]);
  const stats = appStats(coreXml, appXml);
  const title = firstLocalElementText(coreXml, 'title');
  const parsed =
    format === 'docx'
      ? parseDocx(await archive.text('word/document.xml'), limits)
      : format === 'pptx'
        ? await parsePptx(archive, limits)
        : await parseXlsx(archive, limits);
  return { title, stats, ...parsed };
}

/** The text a reader gets in place of the file: the title, each slide or sheet, what was left out. */
export function formatDocumentText(text: DocumentText, format: OoxmlFormat): string {
  const blocks: string[] = [];
  if (text.title !== null) blocks.push(`Title: ${text.title}`);
  for (const item of text.sections) {
    const heading = format === 'xlsx' ? `Sheet "${item.title}":` : `${item.title}:`;
    const lines = item.lines.join('\n');
    blocks.push(format === 'docx' ? lines : `${heading}\n${lines}`);
  }
  if (text.omittedSections > 0) {
    blocks.push(omittedMark(text.omittedSections, format === 'pptx' ? 'slide' : 'sheet'));
  }
  return blocks.join('\n\n');
}
