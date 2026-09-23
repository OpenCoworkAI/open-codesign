import type { PreviewResult, PreviewStep } from '@open-codesign/core';
import type { Page } from 'puppeteer-core';

// These functions are serialized into the preview document, not run in Node.
interface PreviewElement {
  tagName: string;
  id: string;
  innerText?: string;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
  type?: string;
  multiple?: boolean;
  options?: ArrayLike<PreviewElement>;
  form?: PreviewElement | null;
  parentElement: PreviewElement | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  getClientRects(): { length: number };
  contains(element: PreviewElement | null): boolean;
  closest(selector: string): PreviewElement | null;
  matches(selector: string): boolean;
  scrollIntoView(options: { block: string; inline: string }): void;
  focus(): void;
  dispatchEvent(event: object): boolean;
}
declare const document: {
  body: PreviewElement;
  activeElement: PreviewElement | null;
  documentElement: { clientWidth: number; clientHeight: number };
  querySelectorAll(selector: string): ArrayLike<PreviewElement>;
  elementFromPoint(x: number, y: number): PreviewElement | null;
  createEvent(type: string): {
    initEvent(type: string, bubbles: boolean, cancelable: boolean): void;
  };
  defaultView: {
    location: { href: string };
    HTMLInputElement: { prototype: object };
    HTMLTextAreaElement: { prototype: object };
    getComputedStyle(element: PreviewElement): {
      visibility: string;
      display: string;
      opacity: string;
    };
  };
};

interface StepAttempt {
  ok: boolean;
  reason?: string;
  retry?: boolean;
  point?: { x: number; y: number };
}

function inspectStep(step: PreviewStep): StepAttempt {
  const matches = document.querySelectorAll(step.selector);
  const fail = (reason: string, retry = false): StepAttempt => ({ ok: false, reason, retry });
  if (matches.length > 1) return fail(`Ambiguous selector: matched ${matches.length} elements`);
  const element = matches[0];
  if (!element) {
    if (
      step.action === 'assert' &&
      step.visible === false &&
      step.text === undefined &&
      step.value === undefined
    ) {
      return { ok: true };
    }
    return fail('Missing selector: no element matched', true);
  }
  let visible = element.getClientRects().length > 0;
  for (let ancestor: PreviewElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = document.defaultView.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      visible = false;
    }
  }
  if (step.action === 'assert') {
    if (step.visible !== undefined && visible !== step.visible) {
      return fail(`Expected visible=${step.visible}, received ${visible}`, true);
    }
    if (step.text !== undefined && (!visible || !(element.innerText ?? '').includes(step.text))) {
      return fail(
        `Expected visible text containing ${JSON.stringify(step.text)}; received ${JSON.stringify((element.innerText ?? '').slice(0, 2000))}`,
        true,
      );
    }
    if (step.value !== undefined && element.value !== step.value) {
      return fail(
        `Expected value ${JSON.stringify(step.value)}; received ${JSON.stringify(element.value)}`,
        true,
      );
    }
    return { ok: true };
  }
  if (!visible) return fail('Element is not visible', true);
  if (element.matches(':disabled') || element.closest('[inert], [aria-disabled="true"]')) {
    return fail('Element is disabled or inert');
  }
  if (step.action === 'select') {
    if (element.tagName !== 'SELECT' || element.options === undefined) {
      return fail('select requires a native HTML select element');
    }
    if (element.multiple) return fail('select does not support multiple-selection controls');
    const options = Array.from(element.options).filter((option) => option.value === step.value);
    if (options.length === 0) {
      return fail(`No option with value ${JSON.stringify(step.value)} exists`);
    }
    if (options.length > 1) {
      return fail(
        `Ambiguous option value ${JSON.stringify(step.value)}: matched ${options.length} options`,
      );
    }
    const option = options[0];
    if (option?.disabled || option?.closest('optgroup[disabled]')) {
      return fail(
        `Option ${JSON.stringify(step.value)} is disabled or belongs to a disabled optgroup`,
      );
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    return { ok: true };
  }
  if (step.action === 'click' || (step.action === 'press' && step.key === 'Enter')) {
    const form = element.form ?? element.closest('form');
    const target = element.getAttribute('formtarget') ?? form?.getAttribute('target');
    if (target && target !== '_self') {
      return fail('Navigation outside the current preview document is not allowed');
    }
  }
  if (step.action === 'fill') {
    if (
      !['INPUT', 'TEXTAREA'].includes(element.tagName) ||
      element.readOnly ||
      (element.tagName === 'INPUT' &&
        !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(
          element.type ?? '',
        ))
    ) {
      return fail('fill requires an editable text input or textarea');
    }
    element.focus();
    // Use the native setter, bypassing React's instance value tracker.
    const prototype =
      element.tagName === 'INPUT'
        ? document.defaultView.HTMLInputElement.prototype
        : document.defaultView.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return fail('Input has no native value setter');
    setter.call(element, step.value);
    for (const name of ['input', 'change']) {
      const event = document.createEvent('Event');
      event.initEvent(name, true, true);
      element.dispatchEvent(event);
    }
    return { ok: true };
  }
  element.scrollIntoView({ block: 'center', inline: 'center' });
  if (step.action === 'press') {
    element.focus();
    return document.activeElement === element
      ? { ok: true }
      : fail('Element cannot receive keyboard focus');
  }
  const anchor = element.closest('a[href]');
  if (anchor) {
    if (anchor.getAttribute('download') !== null)
      return fail('Downloads are not allowed during preview interactions');
    const target = new URL(anchor.getAttribute('href') ?? '', document.defaultView.location.href);
    const current = new URL(document.defaultView.location.href);
    target.hash = '';
    current.hash = '';
    if (target.href !== current.href || anchor.getAttribute('target') === '_blank') {
      return fail('Navigation outside the current preview document is not allowed');
    }
  }
  const rect = element.getBoundingClientRect();
  const x =
    (Math.max(0, rect.x) + Math.min(document.documentElement.clientWidth, rect.x + rect.width)) / 2;
  const y =
    (Math.max(0, rect.y) + Math.min(document.documentElement.clientHeight, rect.y + rect.height)) /
    2;
  if (!element.contains(document.elementFromPoint(x, y))) {
    return fail('Element is outside the viewport or covered by another element', true);
  }
  return { ok: true, point: { x, y } };
}

export function collectVisibleEvidence(): string {
  const controls = Array.from(
    document.querySelectorAll('button, input, textarea, select, a, [role="button"]'),
  )
    .filter((element) => {
      const style = document.defaultView.getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== 'hidden';
    })
    .slice(0, 60)
    .map((element) => {
      const attrs = ['id', 'name', 'type', 'aria-label', 'placeholder', 'data-testid']
        .map((name) => {
          const value = element.getAttribute(name);
          return value ? `${name}=${JSON.stringify(value.slice(0, 120))}` : '';
        })
        .filter(Boolean)
        .join(' ');
      const value =
        element.value === undefined ? '' : ` value=${JSON.stringify(element.value.slice(0, 200))}`;
      const options =
        element.options === undefined
          ? ''
          : ` options=${JSON.stringify(
              Array.from(element.options)
                .slice(0, 40)
                .map((option) => ({
                  value: option.value?.slice(0, 200),
                  label: option.innerText?.slice(0, 160),
                  disabled: Boolean(option.disabled || option.closest('optgroup[disabled]')),
                })),
            )}`;
      return `<${element.tagName.toLowerCase()} ${attrs}>${(element.innerText ?? '').slice(0, 160)}${value}${options}`;
    });
  return `Visible text:\n${(document.body.innerText ?? '').slice(0, 8000)}\nControls:\n${controls.join('\n')}`.slice(
    0,
    16000,
  );
}

export function boundedPreview<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const result = new Promise<T>((resolve, reject) => {
    abort = () => reject(new Error('Preview cancelled'));
    timer = setTimeout(
      () => reject(new Error('Preview operation timed out')),
      Math.max(1, timeoutMs),
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    operation.then(resolve, reject);
  });
  return result.finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  });
}

export async function runPreviewSteps(
  page: {
    evaluate: (fn: typeof inspectStep, step: PreviewStep) => Promise<StepAttempt>;
    mouse: Pick<Page['mouse'], 'click'>;
    keyboard: Pick<Page['keyboard'], 'press'>;
    select: Page['select'];
  },
  steps: PreviewStep[],
  signal?: AbortSignal,
  navigationFailure: () => string | undefined = () => undefined,
): Promise<NonNullable<PreviewResult['steps']>> {
  const results: NonNullable<PreviewResult['steps']> = [];
  const totalDeadline = Date.now() + 20_000;
  for (const [index, step] of steps.entries()) {
    const deadline = Math.min(Date.now() + 2000, totalDeadline);
    let attempt: StepAttempt = { ok: false, reason: 'Interaction time budget exhausted' };
    try {
      do {
        if (signal?.aborted) throw new Error('Preview cancelled');
        if (Date.now() >= deadline) break;
        attempt = await boundedPreview(
          page.evaluate(inspectStep, step),
          deadline - Date.now(),
          signal,
        );
        if (attempt.ok) {
          if (signal?.aborted) throw new Error('Preview cancelled');
          if (attempt.point) {
            await boundedPreview(
              page.mouse.click(attempt.point.x, attempt.point.y),
              Math.max(1, deadline - Date.now()),
              signal,
            );
          } else if (step.action === 'select') {
            const selected = await boundedPreview(
              page.select(step.selector, step.value),
              Math.max(1, deadline - Date.now()),
              signal,
            );
            if (selected.length !== 1 || selected[0] !== step.value) {
              throw new Error(
                `Select did not choose value ${JSON.stringify(step.value)}; received ${JSON.stringify(selected)}`,
              );
            }
          } else if (step.action === 'press') {
            await boundedPreview(
              page.keyboard.press(step.key),
              Math.max(1, deadline - Date.now()),
              signal,
            );
          }
          // A fixed, bounded settle lets React commit without waiting on network/fonts.
          if (step.action !== 'assert') {
            await boundedPreview(
              new Promise<void>((resolve) => setTimeout(resolve, 100)),
              Math.max(1, deadline - Date.now()),
              signal,
            );
          }
          const blocked = navigationFailure();
          if (blocked) attempt = { ok: false, reason: blocked };
          break;
        }
        if (!attempt.retry) break;
        await boundedPreview(
          new Promise<void>((resolve) => setTimeout(resolve, 50)),
          Math.max(1, deadline - Date.now()),
          signal,
        );
      } while (Date.now() < deadline);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempt = { ok: false, reason: `${attempt.reason ? `${attempt.reason}; ` : ''}${message}` };
    }
    results.push({
      index,
      action: step.action,
      selector: step.selector,
      ok: attempt.ok,
      ...(attempt.reason ? { reason: attempt.reason } : {}),
    });
    if (!attempt.ok) break;
  }
  return results;
}
