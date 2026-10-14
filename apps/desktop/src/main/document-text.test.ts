import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { type DocumentTextLimits, readOoxmlText } from './document-text';

const LIMITS: DocumentTextLimits = {
  maxSections: 16,
  maxParagraphs: 24,
  maxLinesPerSlide: 12,
  maxRowsPerSheet: 24,
  maxCellsPerRow: 8,
  maxLineChars: 260,
};

async function archive(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
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
  const workbook = (...names: string[]) =>
    `<workbook ${S}><sheets>${names.map((name, n) => `<sheet name="${name}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`;

  it('reads shared strings, inline strings and numbers, one row per line', async () => {
    const bytes = await archive({
      'xl/workbook.xml': workbook('Budget &amp; plan', 'Notes'),
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
      'xl/workbook.xml': workbook('One', 'Two', 'Three'),
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
      'xl/workbook.xml': workbook('Empty'),
      'xl/sharedStrings.xml': `<sst ${S}><si><t>Only</t></si><si><t>strings</t></si></sst>`,
      'xl/worksheets/sheet1.xml': sheet(),
    });
    expect((await readOoxmlText(bytes, 'xlsx', LIMITS)).sections).toEqual([
      { title: 'Workbook', lines: ['Only', 'strings'] },
    ]);
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
