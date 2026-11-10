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

export interface SlideTableBorder {
  width: number;
  color: SlideColor;
}

export interface SlideTableCell {
  text: string;
  fontFace: string;
  fontSize: number;
  color: SlideColor;
  fill: SlideColor;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  border?: SlideTableBorder;
  borders?: [SlideTableBorder, SlideTableBorder, SlideTableBorder, SlideTableBorder];
}

export interface SlideChartSeries {
  name: string;
  values: number[];
}

export type NativeSlideElement =
  | (SlideBox & {
      type: 'text';
      runs: SlideTextRun[];
      align: 'left' | 'center' | 'right';
      lineHeight: number;
      layout?: 'lines';
      list?: { kind: 'bullet' | 'number'; level: number; start?: number };
    })
  | (SlideBox & {
      type: 'shape';
      shape: 'rect' | 'roundRect' | 'ellipse';
      radius: number;
      fill: SlideColor;
      stroke: SlideColor;
      strokeWidth: number;
    })
  | (SlideBox & {
      type: 'line';
      stroke: SlideColor;
      strokeWidth: number;
      dash?: 'dash' | 'sysDot';
      flipV?: boolean;
    })
  | (SlideBox & {
      type: 'image';
      data: string;
      fit?: 'cover';
      sourceWidth?: number;
      sourceHeight?: number;
      crop?: { top: number; right: number; bottom: number; left: number };
    })
  | (SlideBox & {
      type: 'table';
      rows: SlideTableCell[][];
      columnWidths: number[];
      rowHeights: number[];
    })
  | (SlideBox & {
      type: 'chart';
      chartType: 'bar' | 'line' | 'pie';
      barDirection?: 'horizontal' | 'vertical';
      colors?: string[];
      showLegend?: boolean;
      showValue?: boolean;
      holeSize?: number;
      labels: string[];
      series: SlideChartSeries[];
    })
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
  checkNumber(node.width, 'width', node.type === 'line' ? 0 : Number.MIN_VALUE, Number.MAX_VALUE);
  checkNumber(node.height, 'height', node.type === 'line' ? 0 : Number.MIN_VALUE, Number.MAX_VALUE);
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
  checkNumber(
    Math.round(box.w * 914400),
    'scaled width (EMU)',
    node.type === 'line' ? 0 : 1,
    27273042316900,
  );
  checkNumber(
    Math.round(box.h * 914400),
    'scaled height (EMU)',
    node.type === 'line' ? 0 : 1,
    27273042316900,
  );
  return box;
}

function imageDataUrl(data: unknown): string {
  const match =
    typeof data === 'string'
      ? /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(data)
      : null;
  if (!match?.[1] || !match[2]) {
    throw new Error('image.data must be an embedded PNG, JPEG or GIF base64 data URL.');
  }
  const mime = match[1].toLowerCase();
  // PptxGenJS uses this header verbatim as the media extension; never lowercase image bytes.
  return `data:image/${mime === 'jpg' ? 'jpeg' : mime};base64,${match[2]}`;
}

function checkElement(node: NativeSlideElement, scale: number): void {
  if (node.type === 'raster') throw new Error('Unresolved native PPTX raster fallback.');
  if (node.type === 'line') {
    if (node.width === 0 && node.height === 0) throw new Error('Line must have a visible length.');
    checkColor(node.stroke, 'line stroke');
    checkNumber(node.strokeWidth * scale * 914400, 'scaled line stroke width (EMU)', 0, 20116800);
    if (node.dash !== undefined && node.dash !== 'dash' && node.dash !== 'sysDot')
      throw new Error('Unsupported line dash.');
    if (node.flipV !== undefined && typeof node.flipV !== 'boolean')
      throw new Error('Invalid line direction.');
  } else if (node.type === 'image') {
    imageDataUrl(node.data);
    if (node.fit !== undefined && node.fit !== 'cover') throw new Error('Unsupported image fit.');
    if (node.fit === 'cover') {
      checkNumber(node.sourceWidth ?? 0, 'image sourceWidth', 1, Number.MAX_VALUE);
      checkNumber(node.sourceHeight ?? 0, 'image sourceHeight', 1, Number.MAX_VALUE);
    }
    if (node.crop) {
      if (node.fit) throw new Error('Image crop and fit cannot be combined.');
      for (const side of ['top', 'right', 'bottom', 'left'] as const)
        checkNumber(node.crop[side], `image crop ${side}`, 0, Number.MAX_VALUE);
      if (
        node.crop.left + node.crop.right >= node.width ||
        node.crop.top + node.crop.bottom >= node.height
      )
        throw new Error('Image crop must leave a visible area.');
    }
  } else if (node.type === 'table') {
    if (
      !Array.isArray(node.rows) ||
      node.rows.length === 0 ||
      !Array.isArray(node.columnWidths) ||
      node.columnWidths.length === 0 ||
      !Array.isArray(node.rowHeights) ||
      node.rowHeights.length !== node.rows.length
    )
      throw new Error('table rows and dimensions must form a nonempty grid.');
    for (const width of node.columnWidths)
      checkNumber(width, 'table column width', Number.MIN_VALUE, Number.MAX_VALUE);
    for (const height of node.rowHeights)
      checkNumber(height, 'table row height', Number.MIN_VALUE, Number.MAX_VALUE);
    for (const row of node.rows) {
      if (!Array.isArray(row) || row.length !== node.columnWidths.length)
        throw new Error('table rows must match column widths.');
      for (const cell of row) {
        if (
          typeof cell.text !== 'string' ||
          typeof cell.fontFace !== 'string' ||
          !cell.fontFace.trim()
        )
          throw new Error('table cell text and fontFace must be strings.');
        checkNumber(cell.fontSize * scale * 72, 'table cell fontSize', 1, 4000);
        checkColor(cell.color, 'table cell color');
        checkColor(cell.fill, 'table cell fill');
        if (cell.borders && cell.borders.length !== 4)
          throw new Error('table cell borders must contain top, right, bottom and left.');
        for (const border of cell.borders ?? (cell.border ? [cell.border] : [])) {
          checkNumber(border.width, 'table cell border width', 0, Number.MAX_VALUE);
          checkColor(border.color, 'table cell border color');
          if (border.width > 0 && border.color.opacity !== 1)
            throw new Error('table cell border transparency is unsupported.');
          checkNumber(
            border.width * scale * 914400,
            'scaled table cell border width (EMU)',
            0,
            20116800,
          );
        }
        if (typeof cell.bold !== 'boolean' || !['left', 'center', 'right'].includes(cell.align))
          throw new Error('Invalid table cell formatting.');
      }
    }
  } else if (node.type === 'chart') {
    if (
      node.colors &&
      (node.colors.length !==
        (node.chartType === 'pie' ? node.labels.length : node.series.length) ||
        node.colors.some((value) => !/^[\da-f]{6}$/i.test(value)))
    )
      throw new Error('Chart colors must be RGB hex values matching the series or pie labels.');
    for (const value of [node.showLegend, node.showValue])
      if (value !== undefined && typeof value !== 'boolean')
        throw new Error('Chart display flags must be booleans.');
    if (node.holeSize !== undefined) {
      if (node.chartType !== 'pie') throw new Error('Only pie charts support a hole size.');
      if (!Number.isInteger(node.holeSize)) throw new Error('chart holeSize must be an integer.');
      checkNumber(node.holeSize, 'chart holeSize', 10, 90);
    }
    if (!['bar', 'line', 'pie'].includes(node.chartType))
      throw new Error('Unsupported chart type.');
    if (
      node.barDirection !== undefined &&
      (node.chartType !== 'bar' || !['horizontal', 'vertical'].includes(node.barDirection))
    )
      throw new Error('Unsupported bar chart direction.');
    if (
      !Array.isArray(node.labels) ||
      node.labels.length === 0 ||
      node.labels.some((label) => typeof label !== 'string')
    )
      throw new Error('chart.labels must be a nonempty string array.');
    if (
      !Array.isArray(node.series) ||
      node.series.length === 0 ||
      (node.chartType === 'pie' && node.series.length !== 1)
    )
      throw new Error('chart.series must contain supported data series.');
    for (const series of node.series) {
      if (typeof series.name !== 'string' || !series.name.trim() || !Array.isArray(series.values))
        throw new Error('Invalid chart series.');
      if (series.values.length !== node.labels.length)
        throw new Error('chart series values must match labels.');
      if (
        series.values.some(
          (value) =>
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            (node.chartType === 'pie' && value < 0),
        )
      )
        throw new Error('chart series values must be finite numbers.');
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
    if (
      node.list &&
      (!['bullet', 'number'].includes(node.list.kind) ||
        !Number.isInteger(node.list.level) ||
        node.list.level < 0 ||
        node.list.level > 31 ||
        (node.list.start !== undefined &&
          (!Number.isInteger(node.list.start) || node.list.start < 1)))
    )
      throw new Error('Invalid list metadata.');
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
      if (node.type === 'line') {
        slide.addShape(pres.ShapeType.line, {
          ...box,
          flipV: node.flipV ?? false,
          line: {
            color: node.stroke.hex,
            transparency: (1 - node.stroke.opacity) * 100,
            width: node.strokeWidth * scale * 72,
            ...(node.dash ? { dashType: node.dash } : {}),
          },
        });
      } else if (node.type === 'image') {
        if (node.crop) {
          const left = node.crop.left * scale;
          const top = node.crop.top * scale;
          const right = node.crop.right * scale;
          const bottom = node.crop.bottom * scale;
          slide.addImage({
            x: box.x + left,
            y: box.y + top,
            w: box.w,
            h: box.h,
            data: imageDataUrl(node.data),
            sizing: {
              type: 'crop',
              x: left,
              y: top,
              w: box.w - left - right,
              h: box.h - top - bottom,
            },
          });
        } else {
          const sourceMax = Math.max(node.sourceWidth ?? 1, node.sourceHeight ?? 1);
          slide.addImage({
            ...box,
            data: imageDataUrl(node.data),
            ...(node.fit === 'cover'
              ? {
                  w: (node.sourceWidth ?? 1) / sourceMax,
                  h: (node.sourceHeight ?? 1) / sourceMax,
                  sizing: { type: 'cover', w: box.w, h: box.h } as const,
                }
              : {}),
          });
        }
      } else if (node.type === 'table') {
        slide.addTable(
          node.rows.map((row) =>
            row.map((cell) => ({
              text: cleanXml(cell.text, 'cell.text', `Slide ${index + 1}, table`, warnings),
              options: {
                fontFace: cleanXml(
                  cell.fontFace,
                  'cell.fontFace',
                  `Slide ${index + 1}, table`,
                  warnings,
                ),
                fontSize: cell.fontSize * scale * 72,
                color: cell.color.hex,
                bold: cell.bold,
                align: cell.align,
                fill: { color: cell.fill.hex, transparency: (1 - cell.fill.opacity) * 100 },
                ...(cell.borders
                  ? {
                      border: cell.borders.map((border) => ({
                        type: border.width > 0 ? ('solid' as const) : ('none' as const),
                        color: border.color.hex,
                        pt: border.width * scale * 72,
                      })) as [
                        PptxGenJS.BorderProps,
                        PptxGenJS.BorderProps,
                        PptxGenJS.BorderProps,
                        PptxGenJS.BorderProps,
                      ],
                    }
                  : cell.border
                    ? {
                        border: {
                          type: 'solid' as const,
                          color: cell.border.color.hex,
                          pt: cell.border.width * scale * 72,
                        },
                      }
                    : {}),
                margin: 0,
              },
            })),
          ),
          {
            ...box,
            colW: node.columnWidths.map((width) => width * scale),
            rowH: node.rowHeights.map((height) => height * scale),
            autoPage: false,
            margin: 0,
          },
        );
      } else if (node.type === 'chart') {
        slide.addChart(
          pres.ChartType[
            node.chartType === 'pie' && node.holeSize !== undefined ? 'doughnut' : node.chartType
          ],
          node.series.map((series) => ({
            name: cleanXml(series.name, 'series.name', `Slide ${index + 1}, chart`, warnings),
            labels: node.labels.map((label) =>
              cleanXml(label, 'label', `Slide ${index + 1}, chart`, warnings),
            ),
            values: series.values,
          })),
          {
            ...box,
            showLegend: node.showLegend ?? node.series.length > 1,
            ...(node.colors ? { chartColors: node.colors } : {}),
            ...(node.holeSize !== undefined ? { holeSize: node.holeSize } : {}),
            ...(node.showValue !== undefined
              ? node.chartType === 'pie'
                ? { showPercent: node.showValue, showLabel: node.showValue }
                : { showValue: node.showValue }
              : {}),
            ...(node.chartType === 'bar'
              ? {
                  barDir: node.barDirection === 'horizontal' ? ('bar' as const) : ('col' as const),
                  // PptxGenJS accepts maxMin at runtime; its declaration only lists minMax.
                  ...(node.barDirection === 'horizontal'
                    ? { catAxisOrientation: 'maxMin' as 'minMax' }
                    : {}),
                }
              : {}),
          },
        );
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
            ...(node.list
              ? {
                  bullet:
                    node.list.kind === 'bullet'
                      ? true
                      : { type: 'number' as const, numberStartAt: node.list.start ?? 1 },
                  indentLevel: node.list.level,
                }
              : {}),
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
