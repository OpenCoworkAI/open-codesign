import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createWorkspaceDocumentPreview } from './document-preview';

async function writeZip(filePath: string, entries: Record<string, string>): Promise<void> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(filePath, bytes);
}

describe('createWorkspaceDocumentPreview', () => {
  it('extracts a lightweight docx preview without treating the file as UTF-8 text', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-docx-preview-'));
    const filePath = path.join(root, 'brief.docx');
    await writeZip(filePath, {
      'docProps/core.xml':
        '<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Snake Assignment</dc:title><dc:creator>Alice</dc:creator></cp:coreProperties>',
      'docProps/app.xml': '<Properties><Pages>2</Pages><Words>1480</Words></Properties>',
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Build a Snake game.</w:t></w:r></w:p><w:p><w:r><w:t>Submit source code and report.</w:t></w:r></w:p></w:body></w:document>',
    });

    const preview = await createWorkspaceDocumentPreview({
      absPath: filePath,
      relPath: 'references/brief.docx',
      generateThumbnail: async () => null,
    });

    expect(preview).toMatchObject({
      schemaVersion: 1,
      path: 'references/brief.docx',
      fileName: 'brief.docx',
      format: 'docx',
      title: 'Snake Assignment',
    });
    expect(preview.stats).toEqual([
      { label: 'Pages', value: '2' },
      { label: 'Words', value: '1480' },
      { label: 'Author', value: 'Alice' },
    ]);
    expect(preview.thumbnailDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const thumbnailSvg = Buffer.from(
      preview.thumbnailDataUrl?.replace(/^data:image\/svg\+xml;base64,/, '') ?? '',
      'base64',
    ).toString('utf8');
    expect(thumbnailSvg).toContain('Snake Assignment');
    expect(thumbnailSvg).toContain('Build a Snake game.');
    expect(preview.sections).toEqual([
      {
        title: 'Document',
        lines: ['Build a Snake game.', 'Submit source code and report.'],
      },
    ]);
  });

  it('extracts slide text from pptx files cross-platform', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-pptx-preview-'));
    const filePath = path.join(root, 'deck.pptx');
    await writeZip(filePath, {
      'docProps/app.xml': '<Properties><Slides>2</Slides></Properties>',
      'ppt/slides/slide2.xml': '<p:sld><a:t>Second slide</a:t><a:t>Timeline</a:t></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:t>Intro</a:t><a:t>Snake rules</a:t></p:sld>',
    });

    const preview = await createWorkspaceDocumentPreview({
      absPath: filePath,
      relPath: 'references/deck.pptx',
      generateThumbnail: async () => 'data:image/png;base64,abc',
    });

    expect(preview.format).toBe('pptx');
    expect(preview.thumbnailDataUrl).toBe('data:image/png;base64,abc');
    expect(preview.stats).toEqual([{ label: 'Slides', value: '2' }]);
    expect(preview.sections).toEqual([
      { title: 'Slide 1', lines: ['Intro', 'Snake rules'] },
      { title: 'Slide 2', lines: ['Second slide', 'Timeline'] },
    ]);
  });

  it('extracts workbook rows from xlsx shared strings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-xlsx-preview-'));
    const filePath = path.join(root, 'rubric.xlsx');
    await writeZip(filePath, {
      'docProps/app.xml': '<Properties><Worksheets>1</Worksheets></Properties>',
      'xl/workbook.xml': '<workbook><sheets><sheet name="评分表" sheetId="1"/></sheets></workbook>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Item</t></si><si><t>Points</t></si><si><t>Gameplay</t></si><si><t>40</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row></sheetData></worksheet>',
    });

    const preview = await createWorkspaceDocumentPreview({
      absPath: filePath,
      relPath: 'references/rubric.xlsx',
      generateThumbnail: async () => null,
    });

    expect(preview.format).toBe('xlsx');
    expect(preview.stats).toEqual([{ label: 'Worksheets', value: '1' }]);
    expect(preview.sections).toEqual([
      { title: '评分表', lines: ['Item · Points', 'Gameplay · 40'] },
    ]);
  });
});
