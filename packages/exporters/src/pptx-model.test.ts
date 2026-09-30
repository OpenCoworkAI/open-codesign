import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it, vi } from 'vitest';
import { extract } from 'zip-lib';
import {
  addNativeSlides,
  type NativeSlideElement,
  type NativeSlideModel,
  slideTransform,
} from './pptx-model';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types';

function parseXml(xml: string) {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(xml, 'application/xml');
  expect(errors, 'XML must parse without recovery').toEqual([]);
  return document;
}

function fixture(): NativeSlideModel {
  return {
    width: 1280,
    height: 720,
    warnings: [],
    elements: [
      {
        type: 'shape',
        shape: 'roundRect',
        radius: 12,
        x: 96,
        y: 96,
        width: 192,
        height: 96,
        fill: { hex: 'FF0000', opacity: 1 },
        stroke: { hex: '000000', opacity: 0 },
        strokeWidth: 0,
      },
      {
        type: 'text',
        x: 96,
        y: 192,
        width: 384,
        height: 96,
        align: 'left',
        lineHeight: 1.2,
        runs: [
          {
            text: '中文 Native text',
            fontFace: 'Arial',
            fontSize: 32,
            color: { hex: '123456', opacity: 1 },
            bold: true,
            italic: false,
            underline: false,
          },
        ],
      },
      { type: 'image', x: 576, y: 96, width: 96, height: 96, data: png },
    ],
  };
}

async function inspectPresentation(pres: PptxGenJS, inspect: (parts: Map<string, string>) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'pptx-native-model-'));
  try {
    const destination = join(directory, 'native.pptx');
    await pres.writeFile({ fileName: destination });
    const unpacked = join(directory, 'unpacked');
    await extract(destination, unpacked);
    const files = (await readdir(unpacked, { recursive: true, withFileTypes: true })).filter(
      (entry) => entry.isFile(),
    );
    const names = new Set(
      files.map((entry) =>
        posix
          .join(entry.parentPath.slice(unpacked.length).replaceAll('\\', '/'), entry.name)
          .replace(/^\//, ''),
      ),
    );
    const parts = new Map<string, string>();
    for (const name of names) {
      if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
      const xml = await readFile(join(unpacked, name), 'utf8');
      const document = parseXml(xml);
      parts.set(name, xml);
      if (name.endsWith('.rels')) {
        for (const rel of Array.from(
          document.getElementsByTagNameNS(relationships, 'Relationship'),
        )) {
          if (rel.getAttribute('TargetMode') === 'External') continue;
          const target = rel.getAttribute('Target') ?? '';
          const base = name === '_rels/.rels' ? '' : posix.dirname(posix.dirname(name));
          const resolved = target.startsWith('/')
            ? target.slice(1)
            : posix.normalize(posix.join(base, target));
          expect(names.has(resolved), `${name}: missing relationship target ${target}`).toBe(true);
        }
      }
    }
    const types = parseXml(parts.get('[Content_Types].xml') ?? '');
    const overrides = Array.from(types.getElementsByTagNameNS(contentTypes, 'Override')).map(
      (entry) => entry.getAttribute('PartName') ?? '',
    );
    expect(new Set(overrides).size, 'ContentTypes overrides must be unique').toBe(overrides.length);
    for (const override of overrides) {
      expect(names.has(override.slice(1)), `missing ContentTypes part ${override}`).toBe(true);
    }
    inspect(parts);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture value');
  return value;
}

function textNode(model: NativeSlideModel) {
  const node = model.elements[1];
  if (!node || node.type !== 'text') throw new Error('Invalid fixture');
  return node;
}

function shapeNode(model: NativeSlideModel) {
  const node = model.elements[0];
  if (!node || node.type !== 'shape') throw new Error('Invalid fixture');
  return node;
}

describe('native slide writer', () => {
  it('fits slides proportionally and rejects invalid dimensions', () => {
    expect(slideTransform(1280, 720).offsetX).toBeCloseTo(0);
    expect(slideTransform(1280, 720).offsetY).toBeCloseTo(0);
    expect(slideTransform(1280, 720).scale * 96).toBeCloseTo(1);
    expect(slideTransform(720, 1280).offsetX).toBeGreaterThan(0);
    expect(slideTransform(720, 1280).offsetY).toBe(0);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => slideTransform(value, 720)).toThrow('positive finite');
    }
  });

  it('writes native text, shapes and an independent picture with scaled geometry', async () => {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    const model = fixture();
    model.warnings = ['Effect simplified'];
    expect(addNativeSlides(pres, [model])).toEqual(['Slide 1: Effect simplified']);
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      expect(document.getElementsByTagNameNS(drawing, 't')[0]?.textContent).toBe(
        '中文 Native text',
      );
      expect(document.getElementsByTagNameNS(drawing, 'prstGeom')[0]?.getAttribute('prst')).toBe(
        'roundRect',
      );
      expect(document.getElementsByTagNameNS(presentation, 'sp').length).toBe(2);
      expect(document.getElementsByTagNameNS(presentation, 'pic').length).toBe(1);
      const off = document
        .getElementsByTagNameNS(drawing, 'xfrm')[1]
        ?.getElementsByTagNameNS(drawing, 'off')[0];
      expect(off?.getAttribute('x')).toBe('914400');
      expect(off?.getAttribute('y')).toBe('914400');
      expect(document.getElementsByTagNameNS(drawing, 'rPr')[0]?.getAttribute('sz')).toBe('2400');
    });
  });

  it.each([
    undefined,
    'source',
  ] as const)('writes portrait geometry with pageLayout=%s using the existing sizing budget', async (pageLayout) => {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    const model = fixture();
    model.width = 720;
    model.height = 1280;
    if (pageLayout !== undefined) model.pageLayout = pageLayout;
    Object.assign(shapeNode(model), { x: 0, y: 0, width: 720, height: 1280 });
    const transform = slideTransform(model.width, model.height);
    const offsetX = pageLayout === 'source' ? 0 : transform.offsetX;
    addNativeSlides(pres, [model]);
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/presentation.xml') ?? '');
      const size = document.getElementsByTagNameNS(presentation, 'sldSz')[0];
      expect(size?.getAttribute('cx')).toBe(pageLayout === 'source' ? '3857625' : '12192000');
      expect(size?.getAttribute('cy')).toBe('6858000');
      const slide = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      const objects = [
        ...Array.from(slide.getElementsByTagNameNS(presentation, 'sp')),
        ...Array.from(slide.getElementsByTagNameNS(presentation, 'pic')),
      ];
      expect(objects).toHaveLength(3);
      for (const [index, object] of objects.entries()) {
        const node = required(model.elements[index]);
        const off = object.getElementsByTagNameNS(drawing, 'off')[0];
        const ext = object.getElementsByTagNameNS(drawing, 'ext')[0];
        expect(off?.getAttribute('x')).toBe(
          String(Math.round((offsetX + node.x * transform.scale) * 914400)),
        );
        expect(off?.getAttribute('y')).toBe(String(Math.round(node.y * transform.scale * 914400)));
        expect(ext?.getAttribute('cx')).toBe(
          String(Math.round(node.width * transform.scale * 914400)),
        );
        expect(ext?.getAttribute('cy')).toBe(
          String(Math.round(node.height * transform.scale * 914400)),
        );
      }
      expect(slide.getElementsByTagNameNS(drawing, 'rPr')[0]?.getAttribute('sz')).toBe('1350');
    });
  });

  it.each([
    null,
    'wide',
    '',
    42,
  ])('rejects invalid pageLayout %s without mutation', (pageLayout) => {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    const defineLayout = vi.spyOn(pres, 'defineLayout');
    const setLayout = vi.spyOn(pres, 'layout', 'set');
    const addSlide = vi.spyOn(pres, 'addSlide');
    const model = fixture();
    Object.assign(model, { pageLayout });
    expect(() => addNativeSlides(pres, [fixture(), model])).toThrow(
      'Slide 2: Unsupported pageLayout',
    );
    expect(defineLayout).not.toHaveBeenCalled();
    expect(setLayout).not.toHaveBeenCalled();
    expect(addSlide).not.toHaveBeenCalled();
    expect(pres.layout).toBe('LAYOUT_WIDE');
  });

  it.each([
    ['source', undefined],
    [undefined, 'source'],
    ['source', 'source'],
  ] as const)('rejects mixed or multiple source pages (%s, %s) without mutation', (first, second) => {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    const defineLayout = vi.spyOn(pres, 'defineLayout');
    const setLayout = vi.spyOn(pres, 'layout', 'set');
    const addSlide = vi.spyOn(pres, 'addSlide');
    expect(() =>
      addNativeSlides(pres, [
        { ...fixture(), ...(first !== undefined ? { pageLayout: first } : {}) },
        { ...fixture(), ...(second !== undefined ? { pageLayout: second } : {}) },
      ]),
    ).toThrow('Source-sized pageLayout requires exactly one slide model.');
    expect(defineLayout).not.toHaveBeenCalled();
    expect(setLayout).not.toHaveBeenCalled();
    expect(addSlide).not.toHaveBeenCalled();
    expect(pres.layout).toBe('LAYOUT_WIDE');
  });

  const malformedSourceCases: [string, (model: NativeSlideModel) => void, string][] = [
    [
      'dimensions',
      (model) => {
        model.width = Number.NaN;
      },
      'positive finite dimensions',
    ],
    [
      'page underflow',
      (model) => {
        model.width = Number.MIN_VALUE;
        model.elements = [];
      },
      'page width (EMU)',
    ],
    [
      'elements',
      (model) => {
        Object.assign(model, { elements: null });
      },
      'elements must be an array',
    ],
    [
      'warnings',
      (model) => {
        Object.assign(model, { warnings: [42] });
      },
      'warnings must be an array of strings',
    ],
    [
      'object',
      (model) => {
        textNode(model).lineHeight = 0;
      },
      'Slide 1, object 2 (text): lineHeight',
    ],
  ];
  it.each(
    malformedSourceCases,
  )('rejects malformed source %s before changing existing PPTX', async (_name, mutate, message) => {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    pres.addSlide().addText('Existing slide');
    const defineLayout = vi.spyOn(pres, 'defineLayout');
    const setLayout = vi.spyOn(pres, 'layout', 'set');
    const addSlide = vi.spyOn(pres, 'addSlide');
    const model = fixture();
    model.pageLayout = 'source';
    model.width = 720;
    model.height = 1280;
    mutate(model);
    expect(() => addNativeSlides(pres, [model])).toThrow(message);
    expect(defineLayout).not.toHaveBeenCalled();
    expect(setLayout).not.toHaveBeenCalled();
    expect(addSlide).not.toHaveBeenCalled();
    expect(pres.layout).toBe('LAYOUT_WIDE');
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/presentation.xml') ?? '');
      const size = document.getElementsByTagNameNS(presentation, 'sldSz')[0];
      expect(size?.getAttribute('cx')).toBe('12192000');
      expect(size?.getAttribute('cy')).toBe('6858000');
      expect(document.getElementsByTagNameNS(presentation, 'sldId').length).toBe(1);
      const slide = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      expect(slide.getElementsByTagNameNS(drawing, 't')[0]?.textContent).toBe('Existing slide');
    });
  });

  it('emits radius adjustments only for roundRect and clamps them to half the shortest side', async () => {
    const pres = new PptxGenJS();
    const model = fixture();
    const original = shapeNode(model);
    model.elements = ['rect', 'ellipse', 'roundRect'].map((shape) => ({
      ...original,
      shape,
      radius: 999,
    })) as NativeSlideElement[];
    addNativeSlides(pres, [model]);
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      const geometries = Array.from(document.getElementsByTagNameNS(drawing, 'prstGeom'));
      expect(geometries.map((element) => element.getAttribute('prst'))).toEqual([
        'rect',
        'ellipse',
        'roundRect',
      ]);
      expect(geometries[0]?.getElementsByTagNameNS(drawing, 'gd').length).toBe(0);
      expect(geometries[1]?.getElementsByTagNameNS(drawing, 'gd').length).toBe(0);
      expect(geometries[2]?.getElementsByTagNameNS(drawing, 'gd')[0]?.getAttribute('fmla')).toBe(
        'val 50000',
      );
    });
  });

  it('preserves XML entities and Unicode while replacing forbidden characters with warnings', async () => {
    const pres = new PptxGenJS();
    const model = fixture();
    const node = textNode(model);
    const text = `中文 😀 & < > " ' &amp;\t\n\u0000\u000b\ufffe\uffff\ud800!\udc00`;
    required(node.runs[0]).text = text;
    required(node.runs[0]).fontFace = `A&B <Font> "Quoted" 'Name'\u0001`;
    expect(addNativeSlides(pres, [model])).toEqual([
      'Slide 1, object 2 (text): Replaced XML-forbidden characters in run 1.text.',
      'Slide 1, object 2 (text): Replaced XML-forbidden characters in run 1.fontFace.',
    ]);
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      const textValues = Array.from(document.getElementsByTagNameNS(drawing, 't'))
        .map((entry) => entry.textContent)
        .join('\n');
      expect(textValues).toBe(`中文 😀 & < > " ' &amp;\t\n�����!�`);
      for (const tag of ['latin', 'ea', 'cs']) {
        expect(document.getElementsByTagNameNS(drawing, tag)[0]?.getAttribute('typeface')).toBe(
          `A&B <Font> "Quoted" 'Name'�`,
        );
      }
    });
    expect(required(node.runs[0]).text).toBe(text);
  });

  it('writes measured lines without shrink/wrap and preserves negative positions and letter spacing', async () => {
    const pres = new PptxGenJS();
    const model = fixture();
    const node = textNode(model);
    node.layout = 'lines';
    node.x = -96;
    node.y = -48;
    required(node.runs[0]).charSpacing = -2;
    model.elements = [node];
    addNativeSlides(pres, [model]);
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      const body = document.getElementsByTagNameNS(drawing, 'bodyPr')[0];
      expect(body?.getAttribute('wrap')).toBe('none');
      expect(body?.getElementsByTagNameNS(drawing, 'normAutofit').length).toBe(0);
      expect(body?.getElementsByTagNameNS(drawing, 'spAutoFit').length).toBe(0);
      expect(document.getElementsByTagNameNS(drawing, 'spcPct')[0]?.getAttribute('val')).toBe(
        '100000',
      );
      expect(document.getElementsByTagNameNS(drawing, 'rPr')[0]?.getAttribute('spc')).toBe('-150');
      const off = document
        .getElementsByTagNameNS(drawing, 'xfrm')[1]
        ?.getElementsByTagNameNS(drawing, 'off')[0];
      expect(off?.getAttribute('x')).toBe('-914400');
      expect(off?.getAttribute('y')).toBe('-457200');
    });
  });

  const invalidCases: [string, (model: NativeSlideModel) => void, string][] = [
    [
      'NaN position',
      (m) => {
        required(m.elements[0]).x = Number.NaN;
      },
      'x',
    ],
    [
      'infinite position',
      (m) => {
        required(m.elements[0]).y = Number.POSITIVE_INFINITY;
      },
      'y',
    ],
    [
      'oversized position',
      (m) => {
        required(m.elements[0]).x = 1e20;
      },
      'scaled x',
    ],
    [
      'zero width',
      (m) => {
        required(m.elements[0]).width = 0;
      },
      'width',
    ],
    [
      'negative height',
      (m) => {
        required(m.elements[0]).height = -1;
      },
      'height',
    ],
    [
      'underflow width',
      (m) => {
        required(m.elements[0]).width = 1e-20;
      },
      'scaled width',
    ],
    [
      'NaN radius',
      (m) => {
        shapeNode(m).radius = Number.NaN;
      },
      'radius',
    ],
    [
      'negative radius',
      (m) => {
        shapeNode(m).radius = -1;
      },
      'radius',
    ],
    [
      'invalid shape',
      (m) => {
        Object.assign(required(m.elements[0]), { shape: 'invalid' });
      },
      'Unsupported shape',
    ],
    [
      'negative stroke',
      (m) => {
        shapeNode(m).strokeWidth = -1;
      },
      'strokeWidth',
    ],
    [
      'oversized stroke',
      (m) => {
        shapeNode(m).strokeWidth = 1e10;
      },
      'strokeWidth',
    ],
    [
      'numeric color',
      (m) => {
        Object.assign(shapeNode(m).fill, { hex: 123456 });
      },
      'fill.hex',
    ],
    [
      'ambiguous inch dimensions',
      (m) => {
        shapeNode(m).width = 9600;
      },
      'scaled w',
    ],
    [
      'invalid fill',
      (m) => {
        shapeNode(m).fill.hex = '#FF0000';
      },
      'fill.hex',
    ],
    [
      'invalid opacity',
      (m) => {
        shapeNode(m).stroke.opacity = 1.1;
      },
      'stroke.opacity',
    ],
    [
      'NaN opacity',
      (m) => {
        required(textNode(m).runs[0]).color.opacity = Number.NaN;
      },
      'color.opacity',
    ],
    [
      'zero font',
      (m) => {
        required(textNode(m).runs[0]).fontSize = 0;
      },
      'fontSize',
    ],
    [
      'oversized font',
      (m) => {
        required(textNode(m).runs[0]).fontSize = 1e10;
      },
      'fontSize',
    ],
    [
      'empty font',
      (m) => {
        required(textNode(m).runs[0]).fontFace = '';
      },
      'fontFace',
    ],
    [
      'invalid line height',
      (m) => {
        textNode(m).lineHeight = 0;
      },
      'lineHeight',
    ],
    [
      'invalid spacing',
      (m) => {
        required(textNode(m).runs[0]).charSpacing = Number.NaN;
      },
      'charSpacing',
    ],
    [
      'empty runs',
      (m) => {
        textNode(m).runs = [];
      },
      'runs',
    ],
    [
      'invalid text',
      (m) => {
        Object.assign(required(textNode(m).runs[0]), { text: 42 });
      },
      'text',
    ],
    [
      'invalid boolean',
      (m) => {
        Object.assign(required(textNode(m).runs[0]), { bold: 'yes' });
      },
      'bold',
    ],
    [
      'invalid alignment',
      (m) => {
        Object.assign(textNode(m), { align: 'invalid' });
      },
      'alignment',
    ],
    [
      'invalid image',
      (m) => {
        Object.assign(required(m.elements[2]), { data: 'https://example.com/image.png' });
      },
      'image.data',
    ],
    [
      'unknown node',
      (m) => {
        Object.assign(required(m.elements[0]), { type: 'unknown' });
      },
      'object type',
    ],
  ];
  it.each(
    invalidCases,
  )('rejects %s with slide/object context before modifying presentation', (_name, mutate, field) => {
    const pres = new PptxGenJS();
    const model = fixture();
    mutate(model);
    const addSlide = vi.spyOn(pres, 'addSlide');
    expect(() => addNativeSlides(pres, [fixture(), model])).toThrow(
      new RegExp(`Slide 2, object \\d+ .*${field}`),
    );
    expect(addSlide).not.toHaveBeenCalled();
  });

  it('includes the page number for invalid model dimensions', () => {
    const model = fixture();
    model.width = Number.NaN;
    const pres = new PptxGenJS();
    const addSlide = vi.spyOn(pres, 'addSlide');
    expect(() => addNativeSlides(pres, [fixture(), model])).toThrow(
      'Slide 2: Native PPTX slides must have positive finite dimensions.',
    );
    expect(addSlide).not.toHaveBeenCalled();
  });

  it('refuses to silently write unresolved image fallbacks', () => {
    const model = fixture();
    model.elements = [
      {
        type: 'raster',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        clip: { x: 0, y: 0, width: 10, height: 10 },
        reason: 'test',
      },
    ];
    expect(() => addNativeSlides(new PptxGenJS(), [model])).toThrow(
      'Slide 1, object 1 (raster): Unresolved',
    );
  });
});

const require = createRequire(import.meta.url);
const CommonJsPptxGenJS = require('pptxgenjs') as typeof PptxGenJS;

describe.each([
  ['ESM', PptxGenJS],
  ['CJS', CommonJsPptxGenJS],
] as const)('PptxGenJS persistent patch (%s)', (_format, Constructor) => {
  it('escapes font attributes exactly once and declares only real package parts in multi-slide decks', async () => {
    const pres = new Constructor();
    const fontFace = `A&B <Font> "Quoted" 'Name' &amp;`;
    for (let index = 0; index < 3; index++)
      pres.addSlide().addText('A & B < C &amp; 😀', { fontFace });
    await inspectPresentation(pres, (parts) => {
      const document = parseXml(parts.get('ppt/slides/slide1.xml') ?? '');
      expect(document.getElementsByTagNameNS(drawing, 't')[0]?.textContent).toBe(
        'A & B < C &amp; 😀',
      );
      for (const tag of ['latin', 'ea', 'cs']) {
        expect(document.getElementsByTagNameNS(drawing, tag)[0]?.getAttribute('typeface')).toBe(
          fontFace,
        );
      }
      expect(
        Array.from(parts.keys()).filter((name) =>
          /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name),
        ),
      ).toEqual(['ppt/slideMasters/slideMaster1.xml']);
    });
  });
});
