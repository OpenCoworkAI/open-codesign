import type PptxGenJS from 'pptxgenjs';

export interface SlideBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideColor {
  hex: string;
  opacity: number;
}

export interface SlideTextRun {
  text: string;
  fontFace: string;
  fontSize: number;
  color: SlideColor;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  charSpacing?: number;
}

export type NativeSlideElement =
  | (SlideBox & {
      type: 'text';
      runs: SlideTextRun[];
      align: 'left' | 'center' | 'right';
      lineHeight: number;
      layout?: 'lines';
    })
  | (SlideBox & {
      type: 'shape';
      shape: 'rect' | 'roundRect' | 'ellipse';
      radius: number;
      fill: SlideColor;
      stroke: SlideColor;
      strokeWidth: number;
    })
  | (SlideBox & { type: 'image'; data: string })
  | (SlideBox & {
      type: 'raster';
      clip: SlideBox;
      reason: string;
      selector?: string;
      capture?: 'subtree' | 'decoration' | 'before' | 'after';
    });

export interface NativeSlideModel {
  width: number;
  height: number;
  pageLayout?: 'source';
  elements: NativeSlideElement[];
  warnings: string[];
}

/** Fit the entire source slide; unlike stretching, this preserves text and image proportions. */
export function slideTransform(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Native PPTX slides must have positive finite dimensions.');
  }
  const slideWidth = 40 / 3;
  const slideHeight = 7.5;
  const scale = Math.min(slideWidth / width, slideHeight / height);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Native PPTX slide dimensions are outside the supported range.');
  }
  return {
    scale,
    offsetX: (slideWidth - width * scale) / 2,
    offsetY: (slideHeight - height * scale) / 2,
  };
}

function checkNumber(value: number, field: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be finite and between ${min} and ${max}; received ${value}.`);
  }
}

function checkColor(color: SlideColor, field: string): void {
  if (!color || typeof color.hex !== 'string' || !/^[\da-f]{6}$/i.test(color.hex)) {
    throw new Error(`${field}.hex must be a six-digit RGB color.`);
  }
  checkNumber(color.opacity, `${field}.opacity`, 0, 1);
}

function objectBox(node: NativeSlideElement, transform: ReturnType<typeof slideTransform>) {
  const { scale, offsetX, offsetY } = transform;
  checkNumber(node.x, 'x', -Number.MAX_VALUE, Number.MAX_VALUE);
  checkNumber(node.y, 'y', -Number.MAX_VALUE, Number.MAX_VALUE);
  checkNumber(node.width, 'width', Number.MIN_VALUE, Number.MAX_VALUE);
  checkNumber(node.height, 'height', Number.MIN_VALUE, Number.MAX_VALUE);
  const box = {
    x: offsetX + node.x * scale,
    y: offsetY + node.y * scale,
    w: node.width * scale,
    h: node.height * scale,
  };
  // PptxGenJS treats numeric values >= 100 as EMUs, not inches.
  for (const [field, value] of Object.entries(box)) {
    if (value >= 100) throw new Error(`scaled ${field} must be less than 100 inches.`);
  }
  // DrawingML ST_Coordinate and ST_PositiveCoordinate bounds, in EMUs.
  checkNumber(Math.round(box.x * 914400), 'scaled x (EMU)', -27273042329600, 27273042316900);
  checkNumber(Math.round(box.y * 914400), 'scaled y (EMU)', -27273042329600, 27273042316900);
  checkNumber(Math.round(box.w * 914400), 'scaled width (EMU)', 1, 27273042316900);
  checkNumber(Math.round(box.h * 914400), 'scaled height (EMU)', 1, 27273042316900);
  return box;
}

function checkElement(node: NativeSlideElement, scale: number): void {
  if (node.type === 'raster') throw new Error('Unresolved native PPTX raster fallback.');
  if (node.type === 'image') {
    if (
      typeof node.data !== 'string' ||
      !/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(node.data)
    ) {
      throw new Error('image.data must be an embedded PNG, JPEG or GIF base64 data URL.');
    }
  } else if (node.type === 'shape') {
    if (!['rect', 'roundRect', 'ellipse'].includes(node.shape))
      throw new Error('Unsupported shape.');
    checkNumber(node.radius, 'radius', 0, Number.MAX_VALUE);
    checkNumber(node.strokeWidth, 'strokeWidth', 0, Number.MAX_VALUE);
    checkNumber(
      Math.round(node.strokeWidth * scale * 914400),
      'scaled strokeWidth (EMU)',
      0,
      20116800,
    );
    checkColor(node.fill, 'fill');
    checkColor(node.stroke, 'stroke');
  } else if (node.type === 'text') {
    if (!['left', 'center', 'right'].includes(node.align))
      throw new Error('Unsupported text alignment.');
    if (node.layout !== undefined && node.layout !== 'lines')
      throw new Error('Unsupported text layout.');
    checkNumber(node.lineHeight, 'lineHeight', Number.MIN_VALUE, 21474.83647);
    if (!Array.isArray(node.runs) || node.runs.length === 0)
      throw new Error('text.runs must not be empty.');
    for (const [index, run] of node.runs.entries()) {
      const field = `run ${index + 1}`;
      if (typeof run.text !== 'string') throw new Error(`${field}.text must be a string.`);
      if (typeof run.fontFace !== 'string' || !run.fontFace.trim())
        throw new Error(`${field}.fontFace must not be empty.`);
      checkNumber(run.fontSize, `${field}.fontSize`, Number.MIN_VALUE, Number.MAX_VALUE);
      checkNumber(
        Math.round(run.fontSize * scale * 7200),
        `${field}.scaled fontSize (hundredths of a point)`,
        100,
        400000,
      );
      checkColor(run.color, `${field}.color`);
      for (const property of ['bold', 'italic', 'underline'] as const) {
        if (typeof run[property] !== 'boolean')
          throw new Error(`${field}.${property} must be a boolean.`);
      }
      if (run.charSpacing !== undefined) {
        checkNumber(run.charSpacing, `${field}.charSpacing`, -Number.MAX_VALUE, Number.MAX_VALUE);
        checkNumber(
          Math.round(run.charSpacing * scale * 7200),
          `${field}.scaled charSpacing (hundredths of a point)`,
          -400000,
          400000,
        );
      }
    }
  } else {
    throw new Error('Unsupported native PPTX object type.');
  }
}

function cleanXml(value: string, field: string, context: string, warnings: Set<string>): string {
  // XML 1.0 allows tab/newline/CR, but not other C0 controls or unpaired surrogates.
  const cleaned = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
      ? character
      : '\uFFFD';
  }).join('');
  if (cleaned !== value) warnings.add(`${context}: Replaced XML-forbidden characters in ${field}.`);
  // Entity escaping belongs to PptxGenJS; pre-escaping ordinary text changes its contents.
  return cleaned;
}

export function addNativeSlides(pres: PptxGenJS, models: NativeSlideModel[]): string[] {
  const warnings = new Set<string>();
  // Validate the whole deck before mutating the presentation; never silently drop bad objects.
  const transforms = models.map((model, index) => {
    let transform: ReturnType<typeof slideTransform>;
    try {
      transform = slideTransform(model.width, model.height);
      if (model.pageLayout !== undefined && model.pageLayout !== 'source') {
        throw new Error('Unsupported pageLayout; expected "source" or undefined.');
      }
      if (model.pageLayout === 'source') {
        if (models.length !== 1) {
          throw new Error('Source-sized pageLayout requires exactly one slide model.');
        }
        transform = { ...transform, offsetX: 0, offsetY: 0 };
        checkNumber(
          Math.round(model.width * transform.scale * 914400),
          'page width (EMU)',
          1,
          12192000,
        );
        checkNumber(
          Math.round(model.height * transform.scale * 914400),
          'page height (EMU)',
          1,
          6858000,
        );
      }
      if (!Array.isArray(model.elements)) throw new Error('elements must be an array.');
      if (
        !Array.isArray(model.warnings) ||
        model.warnings.some((warning) => typeof warning !== 'string')
      ) {
        throw new Error('warnings must be an array of strings.');
      }
    } catch (error) {
      throw new Error(
        `Slide ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const [objectIndex, node] of model.elements.entries()) {
      try {
        objectBox(node, transform);
        checkElement(node, transform.scale);
      } catch (error) {
        throw new Error(
          `Slide ${index + 1}, object ${objectIndex + 1} (${node?.type ?? 'unknown'}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { model, transform, index };
  });
  const sourcePage = transforms[0];
  if (sourcePage?.model.pageLayout === 'source') {
    const { model, transform } = sourcePage;
    pres.defineLayout({
      name: 'NATIVE_SOURCE',
      width: model.width * transform.scale,
      height: model.height * transform.scale,
    });
    pres.layout = 'NATIVE_SOURCE';
  }
  for (const { model, transform, index } of transforms) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    const { scale } = transform;
    for (const warning of model.warnings) warnings.add(`Slide ${index + 1}: ${warning}`);
    for (const [objectIndex, node] of model.elements.entries()) {
      const box = objectBox(node, transform);
      if (node.type === 'raster') throw new Error('Unresolved native PPTX raster fallback.');
      if (node.type === 'image') {
        slide.addImage({ ...box, data: node.data });
      } else if (node.type === 'shape') {
        slide.addShape(pres.ShapeType[node.shape], {
          ...box,
          ...(node.shape === 'roundRect'
            ? { rectRadius: Math.min(node.radius, node.width / 2, node.height / 2) * scale }
            : {}),
          fill: { color: node.fill.hex, transparency: (1 - node.fill.opacity) * 100 },
          line: {
            color: node.stroke.hex,
            transparency: (1 - node.stroke.opacity) * 100,
            width: node.strokeWidth * scale * 72,
          },
        });
      } else {
        const context = `Slide ${index + 1}, object ${objectIndex + 1} (text)`;
        slide.addText(
          node.runs.map((run, runIndex) => ({
            text: cleanXml(run.text, `run ${runIndex + 1}.text`, context, warnings),
            options: {
              fontFace: cleanXml(run.fontFace, `run ${runIndex + 1}.fontFace`, context, warnings),
              fontSize: run.fontSize * scale * 72,
              ...(run.charSpacing !== undefined
                ? { charSpacing: run.charSpacing * scale * 72 }
                : {}),
              color: run.color.hex,
              transparency: (1 - run.color.opacity) * 100,
              bold: run.bold,
              italic: run.italic,
              underline: run.underline ? { style: 'sng' as const } : { style: 'none' as const },
            },
          })),
          {
            ...box,
            margin: 0,
            breakLine: false,
            align: node.align,
            valign: 'top',
            lineSpacingMultiple: node.layout === 'lines' ? 1 : node.lineHeight,
            paraSpaceAfter: 0,
            wrap: node.layout !== 'lines',
            fit: node.layout === 'lines' ? 'none' : 'shrink',
          },
        );
      }
    }
  }
  return [...warnings];
}
