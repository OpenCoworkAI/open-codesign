import type { UiDebugElement } from './contract';

// Serialized into the page by Puppeteer; no app state or arbitrary evaluation API is exposed.
interface Element {
  tagName: string;
  parentElement: Element | null;
  children: ArrayLike<Element>;
  innerText?: string;
  value?: string;
  type?: string;
  labels?: ArrayLike<{ textContent: string | null }>;
  getAttribute(name: string): string | null;
  getClientRects(): { length: number };
  matches(selector: string): boolean;
}
declare const document: {
  querySelectorAll(selector: string): ArrayLike<Element>;
  defaultView: {
    getComputedStyle(element: Element): { visibility: string; display: string; opacity: string };
  };
};

export function collectUiElements(): { elements: UiDebugElement[]; elementsTruncated: boolean } {
  const elements: UiDebugElement[] = [];
  for (const element of Array.from(
    document.querySelectorAll(
      'button, input, textarea, select, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="dialog"]',
    ),
  )) {
    if (!element.getClientRects().length) continue;
    let visible = true;
    const path: string[] = [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = document.defaultView.getComputedStyle(ancestor);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
        visible = false;
      const siblings = Array.from(ancestor.parentElement?.children ?? []).filter(
        (sibling) => sibling.tagName === ancestor?.tagName,
      );
      path.unshift(
        `${ancestor.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(ancestor) + 1 || 1})`,
      );
    }
    if (!visible) continue;
    if (elements.length === 120) return { elements, elementsTruncated: true };
    const sensitive =
      element.type === 'password' ||
      /password|token|secret|api.?key/i.test(
        `${element.getAttribute('name') ?? ''} ${element.getAttribute('autocomplete') ?? ''}`,
      );
    let selector = path.join(' > ');
    for (let start = path.length - 1; start >= 0; start--) {
      const candidate = path.slice(start).join(' > ');
      if (document.querySelectorAll(candidate).length === 1) {
        selector = candidate;
        break;
      }
    }
    if (selector.length > 256) continue;
    elements.push({
      selector,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') ?? '',
      label: (
        element.getAttribute('aria-label') ??
        element.labels?.[0]?.textContent ??
        element.getAttribute('title') ??
        element.getAttribute('placeholder') ??
        ''
      ).slice(0, 300),
      text: (element.innerText ?? '').slice(0, 300),
      ...(!sensitive && element.value !== undefined ? { value: element.value.slice(0, 2000) } : {}),
      disabled: element.matches(':disabled, [aria-disabled="true"]'),
    });
  }
  return { elements, elementsTruncated: false };
}
