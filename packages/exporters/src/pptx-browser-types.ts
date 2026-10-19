// Only the APIs used by serialized PPTX callbacks, without enabling DOM globals for Node consumers.
export interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type BrowserStyle = Iterable<string> &
  Record<
    | 'aspectRatio'
    | 'backdropFilter'
    | 'backgroundColor'
    | 'backgroundImage'
    | 'borderBottomLeftRadius'
    | 'borderBottomRightRadius'
    | 'borderBottomWidth'
    | 'borderLeftWidth'
    | 'borderRightWidth'
    | 'borderTopColor'
    | 'borderTopLeftRadius'
    | 'borderTopRightRadius'
    | 'borderTopStyle'
    | 'borderTopWidth'
    | 'boxShadow'
    | 'boxSizing'
    | 'clipPath'
    | 'color'
    | 'content'
    | 'direction'
    | 'display'
    | 'filter'
    | 'fontFamily'
    | 'fontSize'
    | 'fontStyle'
    | 'fontWeight'
    | 'height'
    | 'isolation'
    | 'left'
    | 'letterSpacing'
    | 'listStyleType'
    | 'maskImage'
    | 'mixBlendMode'
    | 'objectFit'
    | 'opacity'
    | 'outlineStyle'
    | 'outlineWidth'
    | 'overflowX'
    | 'overflowY'
    | 'paddingBottom'
    | 'paddingLeft'
    | 'paddingRight'
    | 'paddingTop'
    | 'position'
    | 'rotate'
    | 'scale'
    | 'textDecorationLine'
    | 'textOverflow'
    | 'textShadow'
    | 'textTransform'
    | 'top'
    | 'transform'
    | 'translate'
    | 'verticalAlign'
    | 'visibility'
    | 'webkitLineClamp'
    | 'whiteSpace'
    | 'width'
    | 'writingMode'
    | 'zIndex',
    string
  > & {
    getPropertyValue(property: string): string;
    setProperty(property: string, value: string, priority?: string): void;
  };

export interface BrowserNode {
  nodeType: number;
  textContent: string | null;
  childNodes: Iterable<BrowserNode>;
}

export interface BrowserElement extends BrowserNode {
  tagName: string;
  childElementCount: number;
  children: Iterable<BrowserElement>;
  parentElement: BrowserHtmlElement | null;
  classList: Iterable<string> & { length: number; add(...tokens: string[]): void };
  getBoundingClientRect(): BrowserRect;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  querySelectorAll(selector: 'img'): Iterable<BrowserImageElement>;
  querySelectorAll(selector: string): Iterable<BrowserElement>;
  closest(selector: string): BrowserElement | null;
  contains(node: BrowserNode | null): boolean;
  appendChild(node: BrowserNode): BrowserNode;
  remove(): void;
}

export interface BrowserStyledElement extends BrowserElement {
  style: BrowserStyle;
}

export interface BrowserHtmlElement extends BrowserStyledElement {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

export interface BrowserImageElement extends BrowserHtmlElement {
  complete: boolean;
  naturalWidth: number;
  currentSrc: string;
  src: string;
  loading: string;
}

interface BrowserCanvasElement extends BrowserHtmlElement {
  width: number;
  height: number;
  getContext(
    type: '2d',
    options?: { willReadFrequently: boolean },
  ): {
    fillStyle: string;
    clearRect(x: number, y: number, width: number, height: number): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  } | null;
}

export interface BrowserDocument {
  documentElement: BrowserHtmlElement;
  body: BrowserHtmlElement;
  head: BrowserHtmlElement;
  images: Iterable<BrowserImageElement>;
  fonts: { status: string };
  getElementById(id: string): BrowserHtmlElement | null;
  querySelector<T extends BrowserElement = BrowserElement>(selector: string): T | null;
  querySelectorAll<T extends BrowserElement = BrowserElement>(selector: string): Iterable<T>;
  createElement(tag: 'canvas'): BrowserCanvasElement;
  createElement(tag: string): BrowserHtmlElement;
  createRange(): {
    setStart(node: BrowserNode, offset: number): void;
    setEnd(node: BrowserNode, offset: number): void;
    getBoundingClientRect(): BrowserRect;
  };
}

export interface BrowserConstructor<T> {
  new (): T;
}

export interface BrowserWindow {
  scrollTo(x: number, y: number): void;
}
