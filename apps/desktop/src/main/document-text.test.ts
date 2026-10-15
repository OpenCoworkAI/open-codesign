import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  CELLS_CUT_MARK,
  type DocumentTextLimits,
  DocumentTooLargeError,
  formatDocumentText,
  omittedMark,
  readOoxmlText,
} from './document-text';

const LIMITS: DocumentTextLimits = {
  maxSections: 16,
  maxParagraphs: 24,
  maxLinesPerSlide: 12,
  maxRowsPerSheet: 24,
  maxCellsPerRow: 8,
  maxLineChars: 260,
  maxUnpackedBytes: 64 * 1024 * 1024,
  markCuts: false,
};

async function archive(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationship = (id: string, kind: string, target: string) =>
  `<Relationship Id="${id}" Type="${OFFICE_RELATIONSHIPS}/${kind}" Target="${target}"/>`;
const relationships = (...items: string[]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
const tab = (name: string, id: string) => `<sheet name="${name}" sheetId="1" r:id="${id}"/>`;
const workbookXml = (...tabs: string[]) =>
  `<workbook ${S} xmlns:r="${OFFICE_RELATIONSHIPS}"><sheets>${tabs.join('')}</sheets></workbook>`;
/** The workbook part and its relationships, with tab n on the part `worksheets/sheet<n>.xml`. */
const workbookParts = (...names: string[]) => ({
  'xl/workbook.xml': workbookXml(...names.map((name, n) => tab(name, `rId${n + 1}`))),
  'xl/_rels/workbook.xml.rels': relationships(
    ...names.map((_, n) =>
      relationship(`rId${n + 1}`, 'worksheet', `worksheets/sheet${n + 1}.xml`),
    ),
  ),
});
const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const slide = (...lines: string[]) =>
  `<p:sld ${A}><p:cSld><p:spTree>${lines
    .map((line) => `<p:sp><p:txBody><a:p><a:r><a:t>${line}</a:t></a:r></a:p></p:txBody></p:sp>`)
    .join('')}</p:spTree></p:cSld></p:sld>`;

describe('readOoxmlText: DOCX', () => {
  it('reads paragraphs, joins their runs, decodes entities and drops empty paragraphs', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${[
        '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>',
        '<w:p></w:p>',
        paragraph('Fish &amp; chips &#x41;&#66;'),
      ].join('')}</w:body></w:document>`,
      'docProps/core.xml':
        '<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:title>Brief</dc:title><dc:creator>Ada</dc:creator></cp:coreProperties>',
      'docProps/app.xml': '<Properties><Pages>3</Pages><Words>120</Words></Properties>',
    });
    expect(await readOoxmlText(bytes, 'docx', LIMITS)).toEqual({
      title: 'Brief',
      stats: [
        { label: 'Pages', value: '3' },
        { label: 'Words', value: '120' },
        { label: 'Author', value: 'Ada' },
      ],
      sections: [{ title: 'Document', lines: ['Hello world', 'Fish & chips AB'] }],
      omittedSections: 0,
      missingPart: null,
    });
  });

  it('reads the text runs when the document has no paragraphs', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body><w:t>One</w:t><w:t>Two</w:t></w:body></w:document>`,
    });
    expect((await readOoxmlText(bytes, 'docx', LIMITS)).sections).toEqual([
      { title: 'Document', lines: ['One', 'Two'] },
    ]);
  });

  it('keeps the first paragraphs and shortens a long line, as the limits say', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${[
        paragraph('x'.repeat(50)),
        ...Array.from({ length: 10 }, (_, n) => paragraph(`Paragraph ${n}`)),
      ].join('')}</w:body></w:document>`,
    });
    const text = await readOoxmlText(bytes, 'docx', {
      ...LIMITS,
      maxParagraphs: 3,
      maxLineChars: 20,
    });
    expect(text.sections[0]?.lines).toEqual([`${'x'.repeat(17)}...`, 'Paragraph 0', 'Paragraph 1']);
  });
});

describe('readOoxmlText: PPTX', () => {
  it('reads slides in numeric order, not name order', async () => {
    const bytes = await archive({
      'ppt/slides/slide10.xml': slide('Ten'),
      'ppt/slides/slide2.xml': slide('Two', 'Second line'),
      'ppt/slides/slide1.xml': slide('One &amp; only'),
    });
    expect((await readOoxmlText(bytes, 'pptx', LIMITS)).sections).toEqual([
      { title: 'Slide 1', lines: ['One & only'] },
      { title: 'Slide 2', lines: ['Two', 'Second line'] },
      { title: 'Slide 10', lines: ['Ten'] },
    ]);
  });

  it('applies the slide and line limits it is given', async () => {
    const bytes = await archive({
      'ppt/slides/slide1.xml': slide('a', 'b', 'c', 'd'),
      'ppt/slides/slide2.xml': slide('e'),
      'ppt/slides/slide3.xml': slide('f'),
    });
    const wide = await readOoxmlText(bytes, 'pptx', LIMITS);
    const narrow = await readOoxmlText(bytes, 'pptx', {
      ...LIMITS,
      maxSections: 2,
      maxLinesPerSlide: 2,
    });
    expect(wide.sections.map((s) => s.lines.length)).toEqual([4, 1, 1]);
    expect(narrow.sections).toEqual([
      { title: 'Slide 1', lines: ['a', 'b'] },
      { title: 'Slide 2', lines: ['e'] },
    ]);
  });
});

describe('readOoxmlText: XLSX', () => {
  const sheet = (...rows: string[]) =>
    `<worksheet ${S}><sheetData>${rows.map((row, n) => `<row r="${n + 1}">${row}</row>`).join('')}</sheetData></worksheet>`;

  it('reads shared strings, inline strings and numbers, one row per line', async () => {
    const bytes = await archive({
      ...workbookParts('Budget &amp; plan', 'Notes'),
      'xl/sharedStrings.xml': `<sst ${S}><si><t>Item</t></si><si><r><t>Cost</t></r><r><t> (USD)</t></r></si><si><t>Rent</t></si></sst>`,
      'xl/worksheets/sheet1.xml': sheet(
        '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>',
        '<c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c><c r="C2" t="inlineStr"><is><t>paid</t></is></c>',
        '<c r="A3"></c>',
      ),
      'xl/worksheets/sheet2.xml': sheet('<c r="A1" t="inlineStr"><is><t>Remember</t></is></c>'),
    });
    expect((await readOoxmlText(bytes, 'xlsx', LIMITS)).sections).toEqual([
      { title: 'Budget & plan', lines: ['Item · Cost (USD)', 'Rent · 1200 · paid'] },
      { title: 'Notes', lines: ['Remember'] },
    ]);
  });

  it('applies the cell, row and sheet limits it is given', async () => {
    const cells = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `<c r="${String.fromCharCode(65 + i)}1"><v>${i}</v></c>`,
      ).join('');
    const bytes = await archive({
      ...workbookParts('One', 'Two', 'Three'),
      'xl/worksheets/sheet1.xml': sheet(cells(6), cells(6), cells(6)),
      'xl/worksheets/sheet2.xml': sheet(cells(2)),
      'xl/worksheets/sheet3.xml': sheet(cells(2)),
    });
    expect(
      (
        await readOoxmlText(bytes, 'xlsx', {
          ...LIMITS,
          maxSections: 2,
          maxRowsPerSheet: 2,
          maxCellsPerRow: 3,
        })
      ).sections,
    ).toEqual([
      { title: 'One', lines: ['0 · 1 · 2', '0 · 1 · 2'] },
      { title: 'Two', lines: ['0 · 1'] },
    ]);
  });

  it('falls back to the shared strings when no sheet has rows', async () => {
    const bytes = await archive({
      ...workbookParts('Empty'),
      'xl/sharedStrings.xml': `<sst ${S}><si><t>Only</t></si><si><t>strings</t></si></sst>`,
      'xl/worksheets/sheet1.xml': sheet(),
    });
    expect((await readOoxmlText(bytes, 'xlsx', LIMITS)).sections).toEqual([
      { title: 'Workbook', lines: ['Only', 'strings'] },
    ]);
  });
});

describe('readOoxmlText: XLSX sheets are found through the workbook relationships', () => {
  const sheet = (value: string) =>
    `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${value}</t></is></c></row></sheetData></worksheet>`;
  const read = async (files: Record<string, string>, limits = LIMITS) =>
    readOoxmlText(await archive(files), 'xlsx', limits);

  it('gives each tab the worksheet its relationship names when the tabs are in reverse part order', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml(tab('Revenue', 'rId1'), tab('Expenses', 'rId2')),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId1', 'worksheet', 'worksheets/sheet2.xml'),
        relationship('rId2', 'worksheet', 'worksheets/sheet1.xml'),
      ),
      'xl/worksheets/sheet1.xml': sheet('rent'),
      'xl/worksheets/sheet2.xml': sheet('sales'),
    });
    expect(text.sections).toEqual([
      { title: 'Revenue', lines: ['sales'] },
      { title: 'Expenses', lines: ['rent'] },
    ]);
    expect(text.missingPart).toBeNull();
  });

  it('reads parts whose names do not follow the tab positions, in tab order', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml(
        tab('Tenth', 'rId7'),
        tab('Ninth', 'rId3'),
        tab('Summary', 'rId5'),
      ),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId3', 'worksheet', 'worksheets/sheet9.xml'),
        relationship('rId5', 'worksheet', 'worksheets/summary.xml'),
        relationship('rId7', 'worksheet', 'worksheets/sheet10.xml'),
      ),
      'xl/worksheets/sheet9.xml': sheet('nine'),
      'xl/worksheets/sheet10.xml': sheet('ten'),
      'xl/worksheets/summary.xml': sheet('sum'),
    });
    expect(text.sections).toEqual([
      { title: 'Tenth', lines: ['ten'] },
      { title: 'Ninth', lines: ['nine'] },
      { title: 'Summary', lines: ['sum'] },
    ]);
  });

  it('follows absolute and parent-folder targets', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml(tab('Absolute', 'rId1'), tab('Parent', 'rId2')),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId1', 'worksheet', '/xl/data/one.xml'),
        relationship('rId2', 'worksheet', '../xl/data/../data/two.xml'),
      ),
      'xl/data/one.xml': sheet('one'),
      'xl/data/two.xml': sheet('two'),
    });
    expect(text.sections).toEqual([
      { title: 'Absolute', lines: ['one'] },
      { title: 'Parent', lines: ['two'] },
    ]);
  });

  it('matches the relationship id and the attributes whatever their prefix, order and quotes', async () => {
    const text = await read({
      'xl/workbook.xml': `<workbook ${S} xmlns:rel="${OFFICE_RELATIONSHIPS}"><sheets><sheet rel:id='rId9' sheetId="4" name="Quoted"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Target="worksheets/a.xml" Type="${OFFICE_RELATIONSHIPS}/worksheet" Id="rId9"/></Relationships>`,
      'xl/worksheets/a.xml': sheet('a'),
    });
    expect(text.sections).toEqual([{ title: 'Quoted', lines: ['a'] }]);
  });

  it('reads a sheet name that ends like an attribute as the name, not as the relationship id', async () => {
    const text = await read({
      ...workbookParts('Q1 id='),
      'xl/worksheets/sheet1.xml': sheet('q'),
    });
    expect(text.sections).toEqual([{ title: 'Q1 id=', lines: ['q'] }]);
  });

  it('keeps the next sheet on its own name when a tab has none', async () => {
    const text = await read({
      ...workbookParts('', 'Second'),
      'xl/worksheets/sheet1.xml': sheet('first'),
      'xl/worksheets/sheet2.xml': sheet('second'),
    });
    expect(text.sections).toEqual([
      { title: 'Sheet 1', lines: ['first'] },
      { title: 'Second', lines: ['second'] },
    ]);
  });

  it('trims a sheet name and treats a blank one as none', async () => {
    const text = await read({
      ...workbookParts('  Padded  ', '   '),
      'xl/worksheets/sheet1.xml': sheet('a'),
      'xl/worksheets/sheet2.xml': sheet('b'),
    });
    expect(text.sections.map((item) => item.title)).toEqual(['Padded', 'Sheet 2']);
  });

  it('leaves out a chart sheet and does not count it', async () => {
    const files = {
      'xl/workbook.xml': workbookXml(
        tab('Data', 'rId1'),
        tab('Chart', 'rId2'),
        tab('Totals', 'rId3'),
      ),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        relationship('rId2', 'chartsheet', 'chartsheets/sheet1.xml'),
        relationship('rId3', 'worksheet', 'worksheets/sheet2.xml'),
      ),
      'xl/worksheets/sheet1.xml': sheet('data'),
      'xl/chartsheets/sheet1.xml': `<chartsheet ${S}/>`,
      'xl/worksheets/sheet2.xml': sheet('totals'),
    };
    const all = await read(files);
    expect(all.sections.map((item) => item.title)).toEqual(['Data', 'Totals']);
    expect(all.omittedSections).toBe(0);
    expect(all.missingPart).toBeNull();
    const first = await read(files, { ...LIMITS, maxSections: 1 });
    expect(first.sections.map((item) => item.title)).toEqual(['Data']);
    expect(first.omittedSections).toBe(1);
  });

  it('applies the section limit to the tabs in order, not to the part names', async () => {
    const text = await read(
      {
        'xl/workbook.xml': workbookXml(tab('Later', 'rId1'), tab('Earlier', 'rId2')),
        'xl/_rels/workbook.xml.rels': relationships(
          relationship('rId1', 'worksheet', 'worksheets/sheet2.xml'),
          relationship('rId2', 'worksheet', 'worksheets/sheet1.xml'),
        ),
        'xl/worksheets/sheet1.xml': sheet('one'),
        'xl/worksheets/sheet2.xml': sheet('two'),
      },
      { ...LIMITS, maxSections: 1 },
    );
    expect(text.sections).toEqual([{ title: 'Later', lines: ['two'] }]);
    expect(text.omittedSections).toBe(1);
  });

  it('names the relationships part when the workbook has none', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml(tab('S', 'rId1')),
      'xl/worksheets/sheet1.xml': sheet('x'),
    });
    expect(text.missingPart).toBe('xl/_rels/workbook.xml.rels');
    expect(text.sections).toEqual([]);
  });

  it('names a sheet that has no relationship, and still reads the others', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml(tab('Lost', 'rId8'), tab('Kept', 'rId1')),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
      ),
      'xl/worksheets/sheet1.xml': sheet('kept'),
    });
    expect(text.missingPart).toBe('relationship for sheet "Lost" in xl/_rels/workbook.xml.rels');
    expect(text.sections).toEqual([{ title: 'Kept', lines: ['kept'] }]);
  });

  it('names a sheet that has no relationship id', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml('<sheet name="Bare" sheetId="1"/>'),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
      ),
      'xl/worksheets/sheet1.xml': sheet('x'),
    });
    expect(text.missingPart).toBe('relationship for sheet "Bare" in xl/_rels/workbook.xml.rels');
    expect(text.sections).toEqual([]);
  });

  it('names a worksheet part the archive lacks, and still reads the others', async () => {
    const text = await read({
      'xl/workbook.xml': workbookXml(tab('Gone', 'rId1'), tab('Here', 'rId2')),
      'xl/_rels/workbook.xml.rels': relationships(
        relationship('rId1', 'worksheet', 'worksheets/gone.xml'),
        relationship('rId2', 'worksheet', 'worksheets/here.xml'),
      ),
      'xl/worksheets/here.xml': sheet('here'),
    });
    expect(text.missingPart).toBe('xl/worksheets/gone.xml');
    expect(text.sections).toEqual([{ title: 'Here', lines: ['here'] }]);
  });
});

describe('readOoxmlText: text that looks like markup', () => {
  // `&lt;div&gt;` is the text <div>, and `&amp;lt;` is the text &lt;: each is decoded once.
  const TEXT = 'Use &lt;div&gt; for layout, &amp;lt; stays, 5 &gt; 3';
  const EXPECTED = 'Use <div> for layout, &lt; stays, 5 > 3';
  const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

  it('keeps it in a DOCX paragraph', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${paragraph(TEXT)}</w:body></w:document>`,
    });
    expect((await readOoxmlText(bytes, 'docx', LIMITS)).sections[0]?.lines).toEqual([EXPECTED]);
  });

  it('keeps it on a PPTX slide', async () => {
    const bytes = await archive({ 'ppt/slides/slide1.xml': slide(TEXT) });
    expect((await readOoxmlText(bytes, 'pptx', LIMITS)).sections[0]?.lines).toEqual([EXPECTED]);
  });

  it('keeps it in XLSX shared strings and inline strings', async () => {
    const bytes = await archive({
      ...workbookParts('S &lt;1&gt;'),
      'xl/sharedStrings.xml': `<sst ${S_NS}><si><t>${TEXT}</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet ${S_NS}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>${TEXT}</t></is></c></row></sheetData></worksheet>`,
    });
    expect((await readOoxmlText(bytes, 'xlsx', LIMITS)).sections).toEqual([
      { title: 'S <1>', lines: [`${EXPECTED} · ${EXPECTED}`] },
    ]);
  });

  it('keeps it in the document title and in a line cut to the limit', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${paragraph('&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;')}</w:body></w:document>`,
      'docProps/core.xml':
        '<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:title>&lt;Draft&gt;</dc:title></cp:coreProperties>',
    });
    const text = await readOoxmlText(bytes, 'docx', { ...LIMITS, maxLineChars: 8 });
    expect(text.title).toBe('<Draft>');
    expect(text.sections[0]?.lines).toEqual(['<<<<<...']);
  });
});

describe('readOoxmlText: empty elements', () => {
  const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const strings = `<sst ${S_NS}><si><t>Hello</t></si><si><t>World</t></si></sst>`;
  const sheet = (row: string) =>
    `<worksheet ${S_NS}><sheetData><row r="1">${row}</row></sheetData></worksheet>`;

  it('reads the cell after an empty styled cell as its own text, not as a string index', async () => {
    const bytes = await archive({
      ...workbookParts('S'),
      'xl/sharedStrings.xml': strings,
      'xl/worksheets/sheet1.xml': sheet(
        '<c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c><c r="C1" s="2"/><c r="D1" t="s"><v>1</v></c>',
      ),
    });
    expect((await readOoxmlText(bytes, 'xlsx', LIMITS)).sections).toEqual([
      { title: 'S', lines: ['Hello · World'] },
    ]);
  });

  it('keeps the text of a paragraph nested in another, as one line', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>A</w:t></w:r><w:p><w:r><w:t>B</w:t></w:r></w:p></w:p>${paragraph('C')}</w:body></w:document>`,
    });
    expect((await readOoxmlText(bytes, 'docx', LIMITS)).sections).toEqual([
      { title: 'Document', lines: ['AB', 'C'] },
    ]);
  });

  it('does not read a tag whose attribute value ends with a slash as self-closing', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body><w:p w:note='a/' w:other="b/"><w:r><w:t>Kept</w:t></w:r></w:p></w:body></w:document>`,
    });
    expect((await readOoxmlText(bytes, 'docx', LIMITS)).sections).toEqual([
      { title: 'Document', lines: ['Kept'] },
    ]);
  });

  it('does not let an empty paragraph take the next one with it', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body><w:p/>${paragraph('First')}<w:p/><w:p/>${paragraph('Second')}</w:body></w:document>`,
    });
    expect((await readOoxmlText(bytes, 'docx', LIMITS)).sections).toEqual([
      { title: 'Document', lines: ['First', 'Second'] },
    ]);
  });
});

// The XML is a file the user attached, which can come from anywhere. A scan that backtracks
// takes seconds on these inputs; a single pass takes milliseconds.
describe('readOoxmlText: hostile input', () => {
  const COUNT = 300_000;
  const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const docx = (body: string) => ({
    format: 'docx' as const,
    part: 'word/document.xml',
    xml: `<w:document ${W}><w:body>${body}</w:body></w:document>`,
  });
  const pptx = (body: string) => ({
    format: 'pptx' as const,
    part: 'ppt/slides/slide1.xml',
    xml: `<p:sld ${A}>${body}</p:sld>`,
  });
  const xlsx = (row: string) => ({
    format: 'xlsx' as const,
    part: 'xl/worksheets/sheet1.xml',
    xml: `<worksheet ${S_NS}><sheetData><row r="1">${row}</row></sheetData></worksheet>`,
  });

  it.each([
    ['paragraphs that never close', docx('<w:p>'.repeat(COUNT))],
    ['tags that never end', docx('<w:p'.repeat(COUNT))],
    ['less-than signs in a run', docx(`<w:p><w:r><w:t>${'<'.repeat(COUNT)}</w:t></w:r></w:p>`)],
    [
      'less-than signs written as entities',
      docx(`<w:p><w:r><w:t>${'&lt;'.repeat(COUNT)}</w:t></w:r></w:p>`),
    ],
    ['text runs that never close', pptx('<a:t>'.repeat(COUNT))],
    ['cells that never close', xlsx('<c r="A1">'.repeat(COUNT))],
    ['cells whose tags never end', xlsx('<c r="A1"'.repeat(COUNT))],
  ])('reads %s in linear time', async (_name, { format, part, xml }) => {
    const bytes = await archive({ [part]: xml });
    const start = performance.now();
    await readOoxmlText(bytes, format, LIMITS);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});

describe('readOoxmlText: unpacked size', () => {
  const MIB = 1024 * 1024;

  async function packed(files: Record<string, Buffer | string>): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) {
      zip.file(name, content, { compression: 'DEFLATE', compressionOptions: { level: 9 } });
    }
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('stops an archive that expands far beyond what it weighs, without unpacking it', async () => {
    const bytes = await packed({ 'word/document.xml': Buffer.alloc(40 * MIB, 0x20) });
    expect(bytes.length).toBeLessThan(MIB);
    const start = performance.now();
    await expect(
      readOoxmlText(bytes, 'docx', { ...LIMITS, maxUnpackedBytes: MIB }),
    ).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  it('counts every part against the same budget', async () => {
    const part = (n: number) => slide(`Slide ${n}`.padEnd(600 * 1024, ' '));
    const bytes = await packed({
      'ppt/slides/slide1.xml': part(1),
      'ppt/slides/slide2.xml': part(2),
      'ppt/slides/slide3.xml': part(3),
    });
    await expect(
      readOoxmlText(bytes, 'pptx', { ...LIMITS, maxUnpackedBytes: MIB }),
    ).rejects.toThrow(/more than 1048576 bytes/);
    const roomy = await readOoxmlText(bytes, 'pptx', { ...LIMITS, maxUnpackedBytes: 4 * MIB });
    expect(roomy.sections.map((section) => section.title)).toEqual([
      'Slide 1',
      'Slide 2',
      'Slide 3',
    ]);
  });

  it('reads a document that fits, and a budget of exactly its size', async () => {
    const xml = `<w:document ${W}><w:body>${paragraph('Fits')}</w:body></w:document>`;
    const bytes = await packed({ 'word/document.xml': xml });
    const exact = Buffer.byteLength(xml);
    expect(
      (await readOoxmlText(bytes, 'docx', { ...LIMITS, maxUnpackedBytes: exact })).sections,
    ).toEqual([{ title: 'Document', lines: ['Fits'] }]);
    await expect(
      readOoxmlText(bytes, 'docx', { ...LIMITS, maxUnpackedBytes: exact - 1 }),
    ).rejects.toBeInstanceOf(DocumentTooLargeError);
  });
});

describe('readOoxmlText: what a limit leaves out', () => {
  const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const MARKED: DocumentTextLimits = { ...LIMITS, markCuts: true };
  const cell = (n: number) => `<c r="${String.fromCharCode(65 + n)}1"><v>${n}</v></c>`;
  const row = (cells: number) => Array.from({ length: cells }, (_, n) => cell(n)).join('');
  const sheet = (...rows: string[]) =>
    `<worksheet ${S_NS}><sheetData>${rows.map((r, n) => `<row r="${n + 1}">${r}</row>`).join('')}</sheetData></worksheet>`;

  it('ends a row cut at the cell limit with the cell mark, only when marking is on', async () => {
    const bytes = await archive({
      ...workbookParts('S'),
      'xl/worksheets/sheet1.xml': sheet(row(5), row(3)),
    });
    const limits = { ...MARKED, maxCellsPerRow: 3 };
    expect((await readOoxmlText(bytes, 'xlsx', limits)).sections[0]?.lines).toEqual([
      `0 · 1 · 2 · ${CELLS_CUT_MARK}`,
      '0 · 1 · 2',
    ]);
    expect(
      (await readOoxmlText(bytes, 'xlsx', { ...limits, markCuts: false })).sections[0]?.lines,
    ).toEqual(['0 · 1 · 2', '0 · 1 · 2']);
  });

  it('says how many non-empty rows the row limit left out, and not the empty ones', async () => {
    const bytes = await archive({
      ...workbookParts('S'),
      'xl/worksheets/sheet1.xml': sheet(
        row(1),
        row(1),
        row(1),
        '<c r="A4" s="1"/>',
        row(1),
        row(1),
      ),
    });
    const limits = { ...MARKED, maxRowsPerSheet: 2 };
    expect((await readOoxmlText(bytes, 'xlsx', limits)).sections[0]?.lines).toEqual([
      '0',
      '0',
      omittedMark(3, 'row'),
    ]);
    expect(
      (await readOoxmlText(bytes, 'xlsx', { ...limits, markCuts: false })).sections[0]?.lines,
    ).toEqual(['0', '0']);
  });

  it('says how many paragraphs and slide lines were left out', async () => {
    const docx = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${['a', 'b', '', 'c', 'd'].map(paragraph).join('')}</w:body></w:document>`,
    });
    expect(
      (await readOoxmlText(docx, 'docx', { ...MARKED, maxParagraphs: 2 })).sections[0]?.lines,
    ).toEqual(['a', 'b', omittedMark(2, 'paragraph')]);
    const pptx = await archive({ 'ppt/slides/slide1.xml': slide('a', 'b', 'c') });
    expect(
      (await readOoxmlText(pptx, 'pptx', { ...MARKED, maxLinesPerSlide: 2 })).sections[0]?.lines,
    ).toEqual(['a', 'b', omittedMark(1, 'line')]);
  });

  it('counts the slides and sheets past the section limit, whatever the marking', async () => {
    const pptx = await archive({
      'ppt/slides/slide1.xml': slide('a'),
      'ppt/slides/slide2.xml': slide('b'),
      'ppt/slides/slide3.xml': slide('c'),
    });
    const xlsx = await archive({
      ...workbookParts('One', 'Two'),
      'xl/worksheets/sheet1.xml': sheet(row(1)),
      'xl/worksheets/sheet2.xml': sheet(row(1)),
    });
    for (const markCuts of [true, false]) {
      const limits = { ...LIMITS, markCuts, maxSections: 1 };
      expect((await readOoxmlText(pptx, 'pptx', limits)).omittedSections).toBe(2);
      expect((await readOoxmlText(xlsx, 'xlsx', limits)).omittedSections).toBe(1);
    }
    expect((await readOoxmlText(pptx, 'pptx', LIMITS)).omittedSections).toBe(0);
  });

  it('writes the mark for one thing and for several', () => {
    expect(omittedMark(1, 'row')).toBe('(1 more row not shown)');
    expect(omittedMark(12, 'slide')).toBe('(12 more slides not shown)');
  });

  it('names the part an archive lacks', async () => {
    const bytes = await archive({ 'unrelated.txt': 'x' });
    expect((await readOoxmlText(bytes, 'docx', LIMITS)).missingPart).toBe('word/document.xml');
    expect((await readOoxmlText(bytes, 'pptx', LIMITS)).missingPart).toBe('ppt/slides/slide1.xml');
    expect((await readOoxmlText(bytes, 'xlsx', LIMITS)).missingPart).toBe('xl/workbook.xml');
    const complete = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${paragraph('x')}</w:body></w:document>`,
    });
    expect((await readOoxmlText(complete, 'docx', LIMITS)).missingPart).toBeNull();
  });
});

describe('formatDocumentText', () => {
  const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

  it('writes a DOCX as its paragraphs under the title', async () => {
    const bytes = await archive({
      'word/document.xml': `<w:document ${W}><w:body>${paragraph('First')}${paragraph('Second')}</w:body></w:document>`,
      'docProps/core.xml':
        '<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:title>Brief</dc:title></cp:coreProperties>',
    });
    expect(formatDocumentText(await readOoxmlText(bytes, 'docx', LIMITS), 'docx')).toBe(
      'Title: Brief\n\nFirst\nSecond',
    );
  });

  it('writes a PPTX by slide and says how many slides were left out', async () => {
    const bytes = await archive({
      'ppt/slides/slide1.xml': slide('Hello', 'World'),
      'ppt/slides/slide2.xml': slide('Two'),
      'ppt/slides/slide3.xml': slide('Three'),
    });
    const text = await readOoxmlText(bytes, 'pptx', { ...LIMITS, maxSections: 2 });
    expect(formatDocumentText(text, 'pptx')).toBe(
      'Slide 1:\nHello\nWorld\n\nSlide 2:\nTwo\n\n(1 more slide not shown)',
    );
  });

  it('writes an XLSX by sheet', async () => {
    const bytes = await archive({
      ...workbookParts('Budget'),
      'xl/worksheets/sheet1.xml': `<worksheet ${S_NS}><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row></sheetData></worksheet>`,
    });
    expect(formatDocumentText(await readOoxmlText(bytes, 'xlsx', LIMITS), 'xlsx')).toBe(
      'Sheet "Budget":\n1 · 2',
    );
  });
});

describe('readOoxmlText: input that is not an archive', () => {
  it('rejects', async () => {
    await expect(
      readOoxmlText(new TextEncoder().encode('plain text, not a zip'), 'docx', LIMITS),
    ).rejects.toThrow();
  });

  it('returns no sections for an archive without the expected parts', async () => {
    const bytes = await archive({ 'unrelated.txt': 'x' });
    for (const format of ['docx', 'pptx', 'xlsx'] as const) {
      expect((await readOoxmlText(bytes, format, LIMITS)).sections).toEqual([]);
    }
  });
});
