import type { Page } from 'puppeteer-core';
import { afterEach, expect, it, vi } from 'vitest';
import { collectLayoutSamples, inspectLayout } from './layout-probe';
import { LAYOUT_BUDGET_MS } from './layout-samples';
import { samples } from './layout-test-fixtures';

afterEach(() => vi.useRealTimers());

it('restores the preview viewport before returning a layout timeout', async () => {
  vi.useFakeTimers();
  const desktop = { width: 1280, height: 800 };
  let viewport = desktop;
  let measurements = 0;
  let finishPhone!: () => void;
  const page = {
    viewport: () => viewport,
    setViewport: async (value: typeof desktop) => {
      viewport = value;
    },
    evaluate: async (fn: unknown) => {
      if (fn !== collectLayoutSamples) return undefined;
      measurements += 1;
      if (measurements === 2)
        await new Promise<void>((resolve) => {
          finishPhone = resolve;
        });
      return samples({ viewportWidth: viewport.width, documentWidth: viewport.width });
    },
  } as unknown as Page;
  const outcome = inspectLayout(page).catch((error) => error as Error);
  await vi.advanceTimersByTimeAsync(LAYOUT_BUDGET_MS + 1);
  const error = await outcome;
  if (!(error instanceof Error)) throw new Error('Expected a layout timeout');
  expect(error.message).toContain('timed out');
  const widthWhenCallerResumes = viewport.width;
  finishPhone();
  await vi.advanceTimersByTimeAsync(0);
  expect(viewport.width).toBe(desktop.width);
  expect(widthWhenCallerResumes).toBe(desktop.width);
});

it('does not start measuring or resize after an already cancelled call', async () => {
  const controller = new AbortController();
  controller.abort();
  const viewport = vi.fn();
  const evaluate = vi.fn();
  await expect(
    inspectLayout({ viewport, evaluate } as unknown as Page, controller.signal),
  ).rejects.toThrow('Preview cancelled');
  expect(viewport).not.toHaveBeenCalled();
  expect(evaluate).not.toHaveBeenCalled();
});

it('does not resize later when the desktop measurement outlives its budget', async () => {
  vi.useFakeTimers();
  const setViewport = vi.fn();
  let finishDesktop!: (value: ReturnType<typeof samples>) => void;
  const page = {
    viewport: () => ({ width: 1280, height: 800 }),
    setViewport,
    evaluate: () =>
      new Promise<ReturnType<typeof samples>>((resolve) => {
        finishDesktop = resolve;
      }),
  } as unknown as Page;
  const outcome = inspectLayout(page).catch((error) => error as Error);
  await vi.advanceTimersByTimeAsync(LAYOUT_BUDGET_MS + 1);
  expect(await outcome).toBeInstanceOf(Error);
  finishDesktop(samples());
  await vi.advanceTimersByTimeAsync(0);
  expect(setViewport).not.toHaveBeenCalled();
});

it('restores the viewport before returning cancellation during the phone measurement', async () => {
  const controller = new AbortController();
  const desktop = { width: 1280, height: 800 };
  let viewport = desktop;
  let measurements = 0;
  let finishPhone!: (value: ReturnType<typeof samples>) => void;
  const page = {
    viewport: () => viewport,
    setViewport: async (value: typeof desktop) => {
      viewport = value;
    },
    evaluate: async (fn: unknown) => {
      if (fn !== collectLayoutSamples) return undefined;
      measurements += 1;
      if (measurements === 2) {
        controller.abort();
        return new Promise<ReturnType<typeof samples>>((resolve) => {
          finishPhone = resolve;
        });
      }
      return samples({ viewportWidth: viewport.width });
    },
  } as unknown as Page;
  await expect(inspectLayout(page, controller.signal)).rejects.toThrow('Preview cancelled');
  expect(viewport).toEqual(desktop);
  finishPhone(samples());
  await Promise.resolve();
  expect(viewport).toEqual(desktop);
});
