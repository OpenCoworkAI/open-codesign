import type {
  BrowserConstructor,
  BrowserDocument,
  BrowserElement,
  BrowserHtmlElement,
  BrowserImageElement,
  BrowserNode,
  BrowserSvgElement,
  BrowserStyle as CSSStyleDeclaration,
  BrowserRect as DOMRect,
} from './pptx-browser-types';
import type {
  NativeSlideElement,
  NativeSlideModel,
  SlideBox,
  SlideColor,
  SlideTableCell,
  SlideTextRun,
} from './pptx-model';

type Element = BrowserElement;
type HTMLElement = BrowserHtmlElement;
type HTMLImageElement = BrowserImageElement;
type Node = BrowserNode;
declare const document: BrowserDocument;
declare const Element: BrowserConstructor<Element>;
declare const HTMLElement: BrowserConstructor<HTMLElement>;
declare const HTMLImageElement: BrowserConstructor<HTMLImageElement>;
declare const Node: { TEXT_NODE: number };
declare const getComputedStyle: (element: Element, pseudo?: string | null) => CSSStyleDeclaration;
declare const scrollX: number;
declare const scrollY: number;

/** Serialized into Chromium: keep runtime helpers inside this function. */
export function extractNativeSlide(
  rootNode: unknown,
  platformFonts: Record<string, string> = {},
): NativeSlideModel {
  // ElementHandle supplies the DOM node; its Node-only type must not require lib.dom.
  const root = rootNode as Element;
  const rootRect = root.getBoundingClientRect();
  const elements: NativeSlideElement[] = [];
  const warnings = new Set<string>();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const colors = new Map<string, SlideColor>();
  const number = (value: string) => Number.parseFloat(value) || 0;
  const color = (value: string): SlideColor => {
    const cached = colors.get(value);
    if (cached) return cached;
    if (!context) throw new Error('Unable to resolve CSS colors for PPTX.');
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const rgba = context.getImageData(0, 0, 1, 1).data;
    const result = {
      hex: Array.from(rgba.slice(0, 3), (n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
      opacity: (rgba[3] ?? 255) / 255,
    };
    colors.set(value, result);
    return result;
  };
  const box = (rect: DOMRect): SlideBox => ({
    x: rect.x - rootRect.x,
    y: rect.y - rootRect.y,
    width: rect.width,
    height: rect.height,
  });
  const visible = (el: Element) => {
    if (getComputedStyle(el).visibility !== 'visible') return false;
    for (let current: Element | null = el; current; current = current.parentElement) {
      const s = getComputedStyle(current);
      if (s.display === 'none' || number(s.opacity) === 0) return false;
    }
    return true;
  };
  let nextId = 0;
  const selector = (el: Element) => {
    let id = el.getAttribute('data-codesign-pptx-node');
    if (!id) {
      id = `capture-${nextId++}`;
      el.setAttribute('data-codesign-pptx-node', id);
    }
    return `[data-codesign-pptx-node="${id}"]`;
  };
  const raster = (
    el: Element,
    reason: string,
    capture: 'subtree' | 'decoration' | 'before' | 'after' = 'subtree',
    bounds?: DOMRect,
  ) => {
    const rect = bounds ?? el.getBoundingClientRect();
    const s = getComputedStyle(
      el,
      capture === 'before' || capture === 'after' ? `::${capture}` : null,
    );
    // A decoration image owns its shadow as well as its background, but never its text.
    const shadowNumbers =
      s.boxShadow
        .replace(/rgba?\([^)]*\)/g, '')
        .match(/-?[\d.]+px/g)
        ?.map(number) ?? [];
    const spread = shadowNumbers.reduce((sum, n) => sum + Math.abs(n), 0) * 2;
    const left = Math.max(rootRect.left, rect.left - spread, 0);
    const top = Math.max(rootRect.top, rect.top - spread, 0);
    const right = Math.min(rootRect.right, rect.right + spread);
    const bottom = Math.min(rootRect.bottom, rect.bottom + spread);
    if (right <= left || bottom <= top) return;
    elements.push({
      type: 'raster',
      x: left - rootRect.x,
      y: top - rootRect.y,
      width: right - left,
      height: bottom - top,
      clip: { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top },
      selector: selector(el),
      capture,
      reason,
    });
    warnings.add(
      `${el.tagName.toLowerCase()} ${capture === 'subtree' ? 'contents' : 'decoration'} rasterized (${reason}); ${capture === 'subtree' ? 'this region is not editable' : 'text remains editable'}.`,
    );
  };
  const hasPseudo = (el: Element, pseudo: string) => {
    const s = getComputedStyle(el, pseudo);
    return s.display !== 'none' && s.content !== 'none' && s.content !== 'normal';
  };
  const pureTranslation = (transform: string) => {
    if (transform === 'none') return true;
    const match = /^matrix\(([^)]+)\)$/.exec(transform);
    if (!match) return false;
    const values = match[1]?.split(',').map((value) => Number(value.trim())) ?? [];
    return (
      values.length === 6 &&
      values.every(Number.isFinite) &&
      Math.abs((values[0] ?? 0) - 1) < 0.000001 &&
      Math.abs(values[1] ?? 1) < 0.000001 &&
      Math.abs(values[2] ?? 1) < 0.000001 &&
      Math.abs((values[3] ?? 0) - 1) < 0.000001
    );
  };
  const insetCrop = (clipPath: string, rect: DOMRect) => {
    const match = /^inset\(([^)]+)\)$/.exec(clipPath);
    if (!match) return null;
    const tokens = (match[1] ?? '').trim().split(/\s+/);
    if (tokens.length < 1 || tokens.length > 4) return null;
    const all = [
      tokens[0],
      tokens[1] ?? tokens[0],
      tokens[2] ?? tokens[0],
      tokens[3] ?? tokens[1] ?? tokens[0],
    ];
    const values = all.map((token, index) => {
      const part = /^(\d+(?:\.\d+)?)(px|%)$/.exec(token ?? '');
      if (!part) return Number.NaN;
      const amount = Number(part[1]);
      return part[2] === '%'
        ? (amount * (index % 2 === 0 ? rect.height : rect.width)) / 100
        : amount;
    });
    if (
      values.some((value) => !Number.isFinite(value)) ||
      (values[1] ?? 0) + (values[3] ?? 0) >= rect.width ||
      (values[0] ?? 0) + (values[2] ?? 0) >= rect.height
    )
      return null;
    return {
      top: values[0] ?? 0,
      right: values[1] ?? 0,
      bottom: values[2] ?? 0,
      left: values[3] ?? 0,
    };
  };
  const compositeReason = (el: Element, s: CSSStyleDeclaration): string | null => {
    if (/^(svg|canvas|video|iframe|input|textarea|select)$/i.test(el.tagName))
      return 'complex content';
    if (el.hasAttribute('data-pptx-raster')) return 'explicit image fallback';
    if (
      !pureTranslation(s.transform) ||
      s.rotate !== 'none' ||
      s.scale !== 'none' ||
      s.translate !== 'none'
    )
      return 'CSS transform';
    if (
      s.filter !== 'none' ||
      s.backdropFilter !== 'none' ||
      s.mixBlendMode !== 'normal' ||
      (s.clipPath !== 'none' &&
        !(
          el instanceof HTMLImageElement &&
          s.objectFit === 'fill' &&
          insetCrop(s.clipPath, el.getBoundingClientRect())
        )) ||
      s.maskImage !== 'none'
    )
      return 'CSS compositing';
    if (number(s.opacity) !== 1) return 'group opacity';
    if (s.writingMode !== 'horizontal-tb' || s.direction === 'rtl') return 'vertical or RTL text';
    if (s.textShadow !== 'none') return 'text shadow';
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') return 'clamped text';
    if (
      s.display === 'list-item' &&
      !['none', 'disc', 'circle', 'square', 'decimal'].includes(s.listStyleType)
    )
      return 'unsupported list marker';
    return null;
  };
  const decorationReason = (s: CSSStyleDeclaration): string | null => {
    if (s.backgroundImage !== 'none') return 'background image or gradient';
    if (s.boxShadow !== 'none') return 'shadow';
    if (s.outlineStyle !== 'none' && number(s.outlineWidth) > 0) return 'outline';
    const borders = ['top', 'right', 'bottom', 'left'].map(
      (side) =>
        `${s.getPropertyValue(`border-${side}-width`)} ${s.getPropertyValue(`border-${side}-style`)} ${s.getPropertyValue(`border-${side}-color`)}`,
    );
    if (new Set(borders).size > 1) return 'nonuniform border';
    if (number(s.borderTopWidth) > 0 && s.borderTopStyle !== 'solid') return 'patterned border';
    if (
      new Set([
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomLeftRadius,
        s.borderBottomRightRadius,
      ]).size > 1
    )
      return 'nonuniform corner radius';
    if (s.borderTopLeftRadius.includes(' ')) return 'elliptical corner radius';
    return null;
  };
  const shape = (rect: SlideBox, s: CSSStyleDeclaration) => {
    const fill = color(s.backgroundColor);
    const strokeWidth = number(s.borderTopWidth);
    if (fill.opacity === 0 && strokeWidth === 0) return;
    const radiusValue = s.borderTopLeftRadius;
    const percent = radiusValue.endsWith('%');
    const ellipse = percent && number(radiusValue) >= 50;
    const radius = percent
      ? (Math.min(rect.width, rect.height) * number(radiusValue)) / 100
      : number(radiusValue);
    elements.push({
      type: 'shape',
      ...rect,
      shape: ellipse ? 'ellipse' : radius > 0 ? 'roundRect' : 'rect',
      radius: ellipse ? 0 : Math.min(radius, rect.width / 2, rect.height / 2),
      fill,
      stroke: strokeWidth > 0 ? color(s.borderTopColor) : { hex: '000000', opacity: 0 },
      strokeWidth,
    });
  };
  const pseudo = (el: Element, name: 'before' | 'after') => {
    if (!hasPseudo(el, `::${name}`)) return;
    const s = getComputedStyle(el, `::${name}`);
    const r = el.getBoundingClientRect();
    const simple =
      (s.content === '""' || s.content === "''") &&
      s.position === 'absolute' &&
      s.left.endsWith('px') &&
      s.top.endsWith('px') &&
      s.width.endsWith('px') &&
      s.height.endsWith('px') &&
      !decorationReason(s) &&
      s.transform === 'none' &&
      s.filter === 'none' &&
      number(s.opacity) === 1;
    if (simple) {
      const b = {
        x: r.x - rootRect.x + number(getComputedStyle(el).borderLeftWidth) + number(s.left),
        y: r.y - rootRect.y + number(getComputedStyle(el).borderTopWidth) + number(s.top),
        width: number(s.width),
        height: number(s.height),
      };
      if (b.width > 0 && b.height > 0) shape(b, s);
    } else {
      let bounds = r;
      if (s.position === 'absolute' || s.position === 'fixed') {
        const probe = document.createElement('span');
        for (const property of Array.from(s))
          probe.style.setProperty(property, s.getPropertyValue(property), 'important');
        probe.style.setProperty('visibility', 'hidden', 'important');
        probe.style.setProperty('pointer-events', 'none', 'important');
        if (s.content.startsWith('"') && s.content.endsWith('"'))
          probe.textContent = s.content.slice(1, -1);
        el.appendChild(probe);
        bounds = probe.getBoundingClientRect();
        probe.remove();
      }
      raster(el, `generated ::${name} decoration`, name, bounds);
    }
  };
  const inlineTree = (el: Element): boolean =>
    Array.from(el.children).every((child) => {
      if (!visible(child)) return true;
      if (child.tagName === 'BR') return true;
      if (child instanceof HTMLImageElement) return false;
      const s = getComputedStyle(child);
      return (
        s.display === 'inline' &&
        s.position === 'static' &&
        !compositeReason(child, s) &&
        !decorationReason(s) &&
        color(s.backgroundColor).opacity === 0 &&
        number(s.borderTopWidth) === 0 &&
        s.verticalAlign === 'baseline' &&
        !hasPseudo(child, '::before') &&
        !hasPseudo(child, '::after') &&
        inlineTree(child)
      );
    });
  const listMeta = (el: Element) => {
    if (el.tagName !== 'LI') return undefined;
    if (getComputedStyle(el).listStyleType === 'none') return undefined;
    const parent = el.parentElement;
    if (!parent || (parent.tagName !== 'UL' && parent.tagName !== 'OL')) return undefined;
    let level = 0;
    for (let ancestor = parent.parentElement; ancestor; ancestor = ancestor.parentElement)
      if (ancestor.tagName === 'UL' || ancestor.tagName === 'OL') level++;
    if (parent.tagName === 'UL') return { kind: 'bullet' as const, level };
    const siblings = Array.from(parent.children).filter((child) => child.tagName === 'LI');
    const explicit = Number.parseInt(el.getAttribute('value') ?? '', 10);
    const start = Number.isInteger(explicit)
      ? explicit
      : (Number.parseInt(parent.getAttribute('start') ?? '1', 10) || 1) + siblings.indexOf(el);
    return { kind: 'number' as const, level, start };
  };
  const flattenInline = (el: Element) => {
    const s = getComputedStyle(el);
    return (
      s.display === 'inline' &&
      !compositeReason(el, s) &&
      !decorationReason(s) &&
      color(s.backgroundColor).opacity === 0 &&
      number(s.borderTopWidth) === 0 &&
      !hasPseudo(el, '::before') &&
      !hasPseudo(el, '::after') &&
      inlineTree(el)
    );
  };
  const text = (el: Element, directOnly = false, svgScale?: number) => {
    type Fragment = { rect: DOMRect; run: SlideTextRun; flow: number };
    const fragments: Fragment[] = [];
    let flow = 0;
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const walk = (node: Node, owner: Element) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (directOnly && el.tagName !== 'LI') flow++;
        const s = getComputedStyle(owner);
        if (svgScale !== undefined && s.getPropertyValue('fill') === 'none') return;
        const ink = { ...color(svgScale === undefined ? s.color : s.getPropertyValue('fill')) };
        if (svgScale !== undefined) ink.opacity *= Number(s.getPropertyValue('fill-opacity'));
        const raw = node.textContent ?? '';
        const requested =
          s.fontFamily
            .split(',')[0]
            ?.trim()
            .replace(/^['"]|['"]$/g, '') || 'Arial';
        const fontFace =
          platformFonts[owner.getAttribute('data-codesign-pptx-node') ?? ''] || requested;
        if (
          fontFace !== requested &&
          !/^(serif|sans-serif|monospace|system-ui|ui-sans-serif)$/i.test(requested)
        ) {
          warnings.add(
            `Font resolved to ${fontFace} instead of ${requested}; fonts are not embedded.`,
          );
        }
        for (const part of segmenter.segment(raw)) {
          if (
            /^[\r\n]+$/.test(part.segment) &&
            (s.whiteSpace.startsWith('pre') || s.whiteSpace === 'break-spaces')
          ) {
            flow++;
            continue;
          }
          const range = document.createRange();
          range.setStart(node, part.index);
          range.setEnd(node, part.index + part.segment.length);
          const r = range.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          let value = part.segment;
          if (!s.whiteSpace.startsWith('pre') && s.whiteSpace !== 'break-spaces')
            value = value.replace(/\s+/g, ' ');
          if (s.textTransform === 'uppercase') value = value.toUpperCase();
          if (s.textTransform === 'lowercase') value = value.toLowerCase();
          const previous = fragments.at(-1);
          if (value === ' ' && previous?.run.text === ' ' && Math.abs(previous.rect.x - r.x) < 0.1)
            continue;
          fragments.push({
            rect: r,
            flow,
            run: {
              text: value,
              fontFace,
              fontSize: number(s.fontSize) * (svgScale ?? 1),
              color: { ...ink },
              bold: number(s.fontWeight) >= 600 || s.fontWeight === 'bold',
              italic: s.fontStyle !== 'normal',
              underline: s.textDecorationLine.includes('underline'),
              charSpacing: number(s.letterSpacing) * (svgScale ?? 1),
            },
          });
        }
      } else if (node instanceof Element && visible(node)) {
        if (node.tagName === 'BR') {
          flow++;
          return;
        }
        for (const child of node.childNodes)
          if (
            !directOnly ||
            child.nodeType === Node.TEXT_NODE ||
            (el.tagName === 'LI' && child instanceof Element && flattenInline(child))
          )
            walk(child, node);
      }
    };
    walk(el, el);
    const lines: Fragment[][] = [];
    for (const fragment of fragments) {
      const last = lines.at(-1);
      const first = last?.[0];
      const overlap = first
        ? Math.min(first.rect.bottom, fragment.rect.bottom) -
          Math.max(first.rect.top, fragment.rect.top)
        : 0;
      const previous = last?.at(-1);
      const gap = previous ? fragment.rect.left - previous.rect.right : 0;
      if (
        first &&
        previous &&
        first.flow === fragment.flow &&
        gap <= Math.max(1.5, previous.run.charSpacing ?? 0) &&
        overlap > Math.min(first.rect.height, fragment.rect.height) * 0.5 &&
        fragment.rect.left >= first.rect.left - 1
      )
        last?.push(fragment);
      else lines.push([fragment]);
    }
    for (const line of lines) {
      while (line[0]?.run.text === ' ') line.shift();
      while (line.at(-1)?.run.text === ' ') line.pop();
      if (!line.length) continue;
      const runs: SlideTextRun[] = [];
      for (const { run } of line) {
        const previous = runs.at(-1);
        if (
          previous &&
          previous.fontFace === run.fontFace &&
          previous.fontSize === run.fontSize &&
          previous.bold === run.bold &&
          previous.italic === run.italic &&
          previous.underline === run.underline &&
          previous.color.hex === run.color.hex &&
          previous.color.opacity === run.color.opacity &&
          previous.charSpacing === run.charSpacing
        )
          previous.text += run.text;
        else runs.push({ ...run });
      }
      const left = Math.min(...line.map((f) => f.rect.left));
      const top = Math.min(...line.map((f) => f.rect.top));
      const right = Math.max(...line.map((f) => f.rect.right));
      const bottom = Math.max(...line.map((f) => f.rect.bottom));
      const size = Math.max(...runs.map((run) => run.fontSize));
      // Range top is the measured font box, not the CSS block top; keep that origin for Office.
      const y = top;
      const list = listMeta(el);
      elements.push({
        type: 'text',
        x: left - rootRect.x,
        y: y - rootRect.y,
        width: Math.max(1, right - left + 1),
        height: Math.max(size * 1.2, bottom - y),
        runs,
        align: 'left',
        lineHeight: 1,
        layout: 'lines',
        ...(list ? { list } : {}),
      });
    }
  };
  const clipped = (el: Element, s: CSSStyleDeclaration) => {
    if (!(el instanceof HTMLElement)) return false;
    if (
      (s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) ||
      (s.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1)
    )
      return true;
    const rect = el.getBoundingClientRect();
    return Array.from(el.children).some((child) => {
      if (!visible(child)) return false;
      const r = child.getBoundingClientRect();
      return (
        (s.overflowX !== 'visible' && (r.left < rect.left - 1 || r.right > rect.right + 1)) ||
        (s.overflowY !== 'visible' && (r.top < rect.top - 1 || r.bottom > rect.bottom + 1))
      );
    });
  };
  const extractSvg = (svg: Element, viewport: DOMRect) => {
    if (svg.tagName.toLowerCase() !== 'svg') return false;
    const nodes = [svg, ...Array.from(svg.querySelectorAll('*'))].filter(visible);
    const primitiveTags = ['rect', 'circle', 'ellipse', 'line', 'text'];
    const transforms = new Map<Element, number>();
    // Preflight the whole SVG before emitting objects; an unsupported child must not
    // leave native text behind when the same SVG is captured as an image.
    for (const node of nodes) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'title' || tag === 'desc') continue;
      if (!['svg', 'g', 'tspan', ...primitiveTags].includes(tag) || (tag === 'svg' && node !== svg))
        return false;
      const s = getComputedStyle(node);
      const matrix = (node as BrowserSvgElement).getScreenCTM();
      if (
        !matrix ||
        ![matrix.a, matrix.b, matrix.c, matrix.d].every(Number.isFinite) ||
        matrix.a <= 0 ||
        matrix.d <= 0 ||
        Math.abs(matrix.b) > 0.000001 ||
        Math.abs(matrix.c) > 0.000001 ||
        Math.abs(matrix.a - matrix.d) > 0.000001
      )
        return false;
      transforms.set(node, matrix.a);
      if (
        node.hasAttribute('data-pptx-raster') ||
        s.filter !== 'none' ||
        s.backdropFilter !== 'none' ||
        s.mixBlendMode !== 'normal' ||
        s.clipPath !== 'none' ||
        s.maskImage !== 'none' ||
        number(s.opacity) !== 1 ||
        s.textShadow !== 'none' ||
        decorationReason(s) ||
        color(s.backgroundColor).opacity !== 0 ||
        s.getPropertyValue('vector-effect') === 'non-scaling-stroke' ||
        hasPseudo(node, '::before') ||
        hasPseudo(node, '::after')
      )
        return false;
      const fill = s.getPropertyValue('fill');
      const stroke = s.getPropertyValue('stroke');
      if (fill.includes('url(') || stroke.includes('url(')) return false;
      const dash = s.getPropertyValue('stroke-dasharray');
      if (dash !== 'none' && (tag !== 'line' || dash.split(/[ ,]+/).filter(Boolean).length !== 2))
        return false;
      if (
        (tag === 'text' || tag === 'tspan') &&
        (stroke !== 'none' ||
          s.writingMode !== 'horizontal-tb' ||
          s.direction === 'rtl' ||
          node.hasAttribute('textLength') ||
          node.hasAttribute('rotate'))
      )
        return false;
      if (
        tag === 'rect' &&
        node.hasAttribute('ry') &&
        node.getAttribute('ry') !== node.getAttribute('rx')
      )
        return false;
      if (primitiveTags.includes(tag)) {
        const r = node.getBoundingClientRect();
        if (
          r.left < viewport.left - 1 ||
          r.right > viewport.right + 1 ||
          r.top < viewport.top - 1 ||
          r.bottom > viewport.bottom + 1 ||
          r.left < rootRect.left - 1 ||
          r.right > rootRect.right + 1 ||
          r.top < rootRect.top - 1 ||
          r.bottom > rootRect.bottom + 1
        )
          return false;
      }
    }
    for (const node of nodes) {
      const tag = node.tagName.toLowerCase();
      if (!primitiveTags.includes(tag)) continue;
      const s = getComputedStyle(node);
      const scale = transforms.get(node) ?? 1;
      const r = node.getBoundingClientRect();
      const svgColor = (property: 'fill' | 'stroke') => {
        const value = s.getPropertyValue(property);
        if (value === 'none') return { hex: '000000', opacity: 0 };
        const resolved = color(value);
        return {
          ...resolved,
          opacity: resolved.opacity * Number(s.getPropertyValue(`${property}-opacity`)),
        };
      };
      const stroke = svgColor('stroke');
      const strokeWidth = number(s.getPropertyValue('stroke-width')) * scale;
      if (tag === 'text') {
        if (s.getPropertyValue('fill') !== 'none') text(node, false, scale);
      } else if (tag === 'line') {
        if (stroke.opacity === 0 || strokeWidth === 0 || (r.width === 0 && r.height === 0))
          continue;
        const xDelta =
          number(node.getAttribute('x2') ?? '0') - number(node.getAttribute('x1') ?? '0');
        const yDelta =
          number(node.getAttribute('y2') ?? '0') - number(node.getAttribute('y1') ?? '0');
        const dashed = s.getPropertyValue('stroke-dasharray') !== 'none';
        elements.push({
          type: 'line',
          ...box(r),
          stroke,
          strokeWidth,
          flipV: xDelta * yDelta < 0,
          ...(dashed ? { dash: 'dash' as const } : {}),
        });
        if (dashed)
          warnings.add(
            `${selector(svg)}: SVG dash lengths approximated with a native dashed line.`,
          );
      } else {
        if (r.width <= 0 || r.height <= 0) continue;
        const fill = svgColor('fill');
        if (fill.opacity === 0 && (stroke.opacity === 0 || strokeWidth === 0)) continue;
        const radiusValue = node.getAttribute('rx') ?? s.getPropertyValue('rx');
        const radius = radiusValue.endsWith('%')
          ? (r.width * number(radiusValue)) / 100
          : number(radiusValue) * scale;
        elements.push({
          type: 'shape',
          ...box(r),
          shape: tag === 'rect' ? (radius > 0 ? 'roundRect' : 'rect') : 'ellipse',
          radius: tag === 'rect' ? Math.min(radius, r.width / 2, r.height / 2) : 0,
          fill,
          stroke,
          strokeWidth: stroke.opacity === 0 ? 0 : strokeWidth,
        });
      }
    }
    if (
      svg.hasAttribute('data-research-values') ||
      /chart|图/.test(svg.getAttribute('aria-label') ?? '')
    )
      warnings.add(
        `${selector(svg)}: SVG chart exported as editable shapes and text; chart data series are unavailable without data-pptx-chart.`,
      );
    return true;
  };
  const extractChart = (el: Element, rect: DOMRect) => {
    const raw = el.getAttribute('data-pptx-chart');
    if (raw === null) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid data-pptx-chart JSON on ${selector(el)}.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error(`Invalid data-pptx-chart data on ${selector(el)}.`);
    const data = parsed as {
      type?: unknown;
      labels?: unknown;
      series?: unknown;
      barDirection?: unknown;
      colors?: unknown;
      showLegend?: unknown;
      showValue?: unknown;
      holeSize?: unknown;
    };
    const { type, labels, series, barDirection } = data;
    if (
      (type !== 'bar' && type !== 'line' && type !== 'pie') ||
      !Array.isArray(labels) ||
      !Array.isArray(series) ||
      labels.length === 0 ||
      series.length === 0 ||
      labels.some((label: unknown) => typeof label !== 'string') ||
      (type === 'pie' && series.length !== 1) ||
      (barDirection !== undefined &&
        (type !== 'bar' || (barDirection !== 'horizontal' && barDirection !== 'vertical')))
    )
      throw new Error(`Invalid data-pptx-chart data on ${selector(el)}.`);
    const { colors, showLegend, showValue, holeSize } = data;
    if (
      (colors !== undefined &&
        (!Array.isArray(colors) ||
          colors.length !== (type === 'pie' ? labels.length : series.length) ||
          colors.some(
            (value: unknown) => typeof value !== 'string' || !/^#?[\da-f]{6}$/i.test(value),
          ))) ||
      [showLegend, showValue].some((value) => value !== undefined && typeof value !== 'boolean') ||
      (holeSize !== undefined &&
        (type !== 'pie' ||
          typeof holeSize !== 'number' ||
          !Number.isInteger(holeSize) ||
          holeSize < 10 ||
          holeSize > 90))
    )
      throw new Error(`Invalid data-pptx-chart styling on ${selector(el)}.`);
    const checkedSeries: { name: string; values: number[] }[] = [];
    for (const item of series as unknown[]) {
      if (!item || typeof item !== 'object')
        throw new Error(`Invalid data-pptx-chart series on ${selector(el)}.`);
      const candidate = item as { name?: unknown; values?: unknown };
      if (
        typeof candidate.name !== 'string' ||
        !candidate.name.trim() ||
        !Array.isArray(candidate.values) ||
        candidate.values.length !== labels.length ||
        candidate.values.some(
          (value: unknown) => typeof value !== 'number' || !Number.isFinite(value),
        )
      )
        throw new Error(`Invalid data-pptx-chart series on ${selector(el)}.`);
      checkedSeries.push({ name: candidate.name, values: candidate.values as number[] });
    }
    elements.push({
      type: 'chart',
      ...box(rect),
      chartType: type,
      ...(Array.isArray(colors)
        ? { colors: (colors as string[]).map((value) => value.replace(/^#/, '').toUpperCase()) }
        : {}),
      ...(typeof showLegend === 'boolean' ? { showLegend } : {}),
      ...(typeof showValue === 'boolean' ? { showValue } : {}),
      ...(typeof holeSize === 'number' ? { holeSize } : {}),
      ...(barDirection === 'horizontal' || barDirection === 'vertical' ? { barDirection } : {}),
      labels: labels as string[],
      series: checkedSeries,
    });
    warnings.add(
      `${selector(el)}: Rendered chart replaced by an editable native chart; styling may differ.`,
    );
    return true;
  };
  const extractTable = (el: Element, rect: DOMRect) => {
    if (el.tagName !== 'TABLE') return false;
    const rows = Array.from(el.querySelectorAll('tr'));
    const cells = rows.map((row) =>
      Array.from(row.children).filter((child) => child.tagName === 'TD' || child.tagName === 'TH'),
    );
    if (
      compositeReason(el, getComputedStyle(el)) ||
      decorationReason(getComputedStyle(el)) ||
      number(getComputedStyle(el).borderTopWidth) > 0
    ) {
      raster(el, 'complex table decoration');
      return true;
    }
    if (
      !cells.length ||
      !cells[0]?.length ||
      cells.some(
        (row) =>
          row.length !== cells[0]?.length ||
          row.some(
            (cell) =>
              Number(cell.getAttribute('colspan') ?? '1') !== 1 ||
              Number(cell.getAttribute('rowspan') ?? '1') !== 1 ||
              Array.from(cell.children).some(
                (child) => !['B', 'STRONG', 'EM', 'I', 'SPAN', 'BR'].includes(child.tagName),
              ),
          ),
      )
    ) {
      raster(el, 'irregular or complex table');
      return true;
    }
    const columnWidths = cells[0].map((cell) => cell.getBoundingClientRect().width);
    const rowHeights = rows.map((row) => row.getBoundingClientRect().height);
    if (columnWidths.some((width) => width <= 0) || rowHeights.some((height) => height <= 0)) {
      raster(el, 'table has unmeasurable cells');
      return true;
    }
    for (const row of cells)
      for (const cell of row) {
        const style = getComputedStyle(cell);
        const decoration = decorationReason(style);
        const sides = ['top', 'right', 'bottom', 'left'].map((side) => ({
          width: number(style.getPropertyValue(`border-${side}-width`)),
          pattern: style.getPropertyValue(`border-${side}-style`),
          shade: style.getPropertyValue(`border-${side}-color`),
        }));
        if (
          compositeReason(cell, style) ||
          (decoration && decoration !== 'nonuniform border') ||
          [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomLeftRadius,
            style.borderBottomRightRadius,
          ].some((radius) => number(radius) > 0) ||
          sides.some(
            (side) =>
              side.width > 0 && (side.pattern !== 'solid' || color(side.shade).opacity !== 1),
          )
        ) {
          raster(el, 'complex table cell decoration');
          return true;
        }
      }
    const tableRows: SlideTableCell[][] = cells.map((row) =>
      row.map((cell) => {
        const s = getComputedStyle(cell);
        const borderWidth = number(s.borderTopWidth);
        const borders = ['top', 'right', 'bottom', 'left'].map((side) => ({
          width: number(s.getPropertyValue(`border-${side}-width`)),
          color: color(s.getPropertyValue(`border-${side}-color`)),
        })) as NonNullable<SlideTableCell['borders']>;
        const uniformBorder = new Set(borders.map((border) => JSON.stringify(border))).size === 1;
        return {
          text: (cell.textContent ?? '').trim(),
          fontFace:
            platformFonts[cell.getAttribute('data-codesign-pptx-node') ?? ''] ||
            s.fontFamily
              .split(',')[0]
              ?.trim()
              .replace(/^['"]|['"]$/g, '') ||
            'Arial',
          fontSize: number(s.fontSize),
          color: color(s.color),
          fill: color(s.backgroundColor),
          ...(!uniformBorder
            ? { borders }
            : borderWidth > 0
              ? { border: { width: borderWidth, color: color(s.borderTopColor) } }
              : {}),
          bold: cell.tagName === 'TH' || number(s.fontWeight) >= 600 || s.fontWeight === 'bold',
          align:
            s.textAlign === 'center'
              ? 'center'
              : s.textAlign === 'right' || s.textAlign === 'end'
                ? 'right'
                : 'left',
        };
      }),
    );
    elements.push({ type: 'table', ...box(rect), rows: tableRows, columnWidths, rowHeights });
    return true;
  };
  const visit = (el: Element, deferred?: Set<Element>, paintPositioned = false) => {
    if (
      (deferred?.has(el) && !paintPositioned) ||
      /^(script|style|link|meta|noscript)$/i.test(el.tagName) ||
      !visible(el)
    )
      return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      for (const child of el.children) visit(child, deferred);
      return;
    }
    if (
      rect.right <= rootRect.left ||
      rect.bottom <= rootRect.top ||
      rect.left >= rootRect.right ||
      rect.top >= rootRect.bottom
    )
      return;
    const s = getComputedStyle(el);
    if (extractChart(el, rect) || extractTable(el, rect) || extractSvg(el, rect)) return;
    const reason = compositeReason(el, s);
    if (reason) {
      raster(el, reason);
      return;
    }
    if (clipped(el, s)) {
      raster(el, 'clipped text or content');
      return;
    }
    if (
      rect.left < rootRect.left - 1 ||
      rect.top < rootRect.top - 1 ||
      rect.right > rootRect.right + 1 ||
      rect.bottom > rootRect.bottom + 1
    ) {
      raster(el, 'slide boundary clipping');
      return;
    }
    if (el instanceof HTMLImageElement) {
      if (!el.complete || el.naturalWidth === 0)
        throw new Error(`PPTX image failed to load: ${el.getAttribute('src') ?? '(missing src)'}`);
      const crop = insetCrop(s.clipPath, rect);
      if (
        /^data:image\/(png|jpe?g);base64,/i.test(el.currentSrc || el.src) &&
        (s.objectFit === 'fill' || (s.objectFit === 'cover' && s.objectPosition === '50% 50%')) &&
        (s.clipPath === 'none' || crop) &&
        !decorationReason(s) &&
        number(s.borderTopLeftRadius) === 0 &&
        number(s.borderTopWidth) === 0 &&
        color(s.backgroundColor).opacity === 0 &&
        [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].every((p) => number(p) === 0)
      ) {
        elements.push({
          type: 'image',
          ...box(rect),
          data: el.currentSrc || el.src,
          ...(crop ? { crop } : {}),
          ...(s.objectFit === 'cover'
            ? {
                fit: 'cover' as const,
                sourceWidth: el.naturalWidth,
                sourceHeight: el.naturalHeight,
              }
            : {}),
        });
      } else raster(el, 'image crop or format');
      return;
    }
    const decoration = decorationReason(s);
    if (decoration === 'shadow' && el === root && s.backgroundImage === 'none') {
      warnings.add('Slide outer shadow omitted.');
      shape(box(rect), s);
    } else if (decoration) raster(el, decoration, 'decoration');
    else shape(box(rect), s);
    const children = Array.from(el.children);
    const contexts: Element[] = [];
    const positioned = new Set<Element>();
    if (!deferred) {
      const collect = (parent: Element) => {
        const parentStyle = getComputedStyle(parent);
        for (const child of parent.children) {
          if (!visible(child)) continue;
          const cs = getComputedStyle(child);
          const positionedZ =
            cs.zIndex !== 'auto' &&
            (cs.position !== 'static' ||
              parentStyle.display.includes('flex') ||
              parentStyle.display.includes('grid'));
          const createsContext =
            positionedZ ||
            cs.position === 'fixed' ||
            cs.position === 'sticky' ||
            cs.isolation === 'isolate' ||
            cs.transform !== 'none' ||
            cs.filter !== 'none' ||
            number(cs.opacity) !== 1;
          if (createsContext) contexts.push(child);
          else {
            if (cs.position !== 'static') {
              contexts.push(child);
              positioned.add(child);
            }
            // z-index:auto participates in the positioned paint phase, but its descendants
            // still belong to this stacking context (not a new, artificially isolated one).
            if (!compositeReason(child, cs) && !clipped(child, cs)) collect(child);
          }
        }
      };
      collect(el);
    }
    const pending = deferred ?? new Set(contexts);
    const z = (child: Element) => number(getComputedStyle(child).zIndex);
    for (const child of contexts.filter((child) => z(child) < 0).sort((a, b) => z(a) - z(b)))
      visit(child);
    pseudo(el, 'before');
    if (inlineTree(el)) text(el);
    else {
      // Anonymous inline text is measurable too; do not sacrifice its containing flex/grid card.
      if (
        Array.from(el.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )
      )
        text(el, true);
      for (const child of children)
        if (el.tagName !== 'LI' || !flattenInline(child)) visit(child, pending);
    }
    pseudo(el, 'after');
    for (const child of contexts.filter((child) => z(child) >= 0).sort((a, b) => z(a) - z(b))) {
      if (positioned.has(child)) visit(child, pending, true);
      else visit(child);
    }
  };
  for (const image of root.querySelectorAll('img')) {
    if (visible(image) && (!image.complete || image.naturalWidth === 0))
      throw new Error(`PPTX image failed to load: ${image.getAttribute('src') ?? '(missing src)'}`);
  }
  visit(root);
  return { width: rootRect.width, height: rootRect.height, elements, warnings: [...warnings] };
}
