/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type {
  NativeSlideElement,
  NativeSlideModel,
  SlideBox,
  SlideColor,
  SlideTextRun,
} from './pptx-model';

/** Serialized into Chromium: keep runtime helpers inside this function. */
export function extractNativeSlide(
  root: Element,
  platformFonts: Record<string, string> = {},
): NativeSlideModel {
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
  const compositeReason = (el: Element, s: CSSStyleDeclaration): string | null => {
    if (/^(svg|canvas|table|video|iframe|input|textarea|select)$/i.test(el.tagName))
      return 'complex content';
    if (el.hasAttribute('data-pptx-raster')) return 'explicit image fallback';
    if (
      s.transform !== 'none' ||
      s.rotate !== 'none' ||
      s.scale !== 'none' ||
      s.translate !== 'none'
    )
      return 'CSS transform';
    if (
      s.filter !== 'none' ||
      s.backdropFilter !== 'none' ||
      s.mixBlendMode !== 'normal' ||
      s.clipPath !== 'none' ||
      s.maskImage !== 'none'
    )
      return 'CSS compositing';
    if (number(s.opacity) !== 1) return 'group opacity';
    if (s.writingMode !== 'horizontal-tb' || s.direction === 'rtl') return 'vertical or RTL text';
    if (s.textShadow !== 'none') return 'text shadow';
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') return 'clamped text';
    if (s.display === 'list-item' && s.listStyleType !== 'none') return 'list marker';
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
  const text = (el: Element, directOnly = false) => {
    type Fragment = { rect: DOMRect; run: SlideTextRun; flow: number };
    const fragments: Fragment[] = [];
    let flow = 0;
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const walk = (node: Node, owner: Element) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (directOnly) flow++;
        const s = getComputedStyle(owner);
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
              fontSize: number(s.fontSize),
              color: color(s.color),
              bold: number(s.fontWeight) >= 600 || s.fontWeight === 'bold',
              italic: s.fontStyle !== 'normal',
              underline: s.textDecorationLine.includes('underline'),
              charSpacing: number(s.letterSpacing),
            },
          });
        }
      } else if (node instanceof Element && visible(node)) {
        if (node.tagName === 'BR') {
          flow++;
          return;
        }
        for (const child of node.childNodes)
          if (!directOnly || child.nodeType === Node.TEXT_NODE) walk(child, node);
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
      if (
        /^data:image\/(png|jpe?g);base64,/i.test(el.currentSrc || el.src) &&
        s.objectFit === 'fill' &&
        !decorationReason(s) &&
        number(s.borderTopLeftRadius) === 0 &&
        number(s.borderTopWidth) === 0 &&
        color(s.backgroundColor).opacity === 0 &&
        [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].every((p) => number(p) === 0)
      ) {
        elements.push({ type: 'image', ...box(rect), data: el.currentSrc || el.src });
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
      for (const child of children) visit(child, pending);
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
