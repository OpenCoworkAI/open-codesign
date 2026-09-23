import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedPreview, runPreviewSteps } from './preview-interactions';

afterEach(() => vi.useRealTimers());

describe('preview interaction budgets', () => {
  it('fails a select that no longer finds its option instead of reporting a no-op success', async () => {
    const page = {
      evaluate: vi.fn(async () => ({ ok: true })),
      mouse: { click: vi.fn() },
      keyboard: { press: vi.fn() },
      select: vi.fn(async () => []),
    };
    const results = await runPreviewSteps(page, [
      { action: 'select', selector: '#category', value: 'work' },
      { action: 'assert', selector: '#category', value: 'work' },
    ]);
    expect(page.select).toHaveBeenCalledWith('#category', 'work');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      action: 'select',
      ok: false,
      reason: expect.stringContaining('did not choose value "work"'),
    });
  });

  it('includes the native select operation within the two-second step deadline', async () => {
    vi.useFakeTimers();
    const page = {
      evaluate: vi.fn(async () => ({ ok: true })),
      mouse: { click: vi.fn() },
      keyboard: { press: vi.fn() },
      select: vi.fn(() => new Promise<string[]>(() => {})),
    };
    const result = runPreviewSteps(page, [
      { action: 'select', selector: '#category', value: 'work' },
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual([
      expect.objectContaining({
        action: 'select',
        ok: false,
        reason: expect.stringContaining('timed out'),
      }),
    ]);
  });

  it('bounds a hung browser operation and removes its cancellation listener', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = boundedPreview(new Promise<never>(() => {}), 2000, controller.signal);
    const assertion = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a hung browser operation and clears its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = boundedPreview(new Promise<never>(() => {}), 2000, controller.signal);
    const assertion = expect(promise).rejects.toThrow('cancelled');
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the entire sequence at twenty seconds even when individual assertions eventually pass', async () => {
    vi.useFakeTimers();
    const page = {
      evaluate: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1900));
        return { ok: true };
      }),
      mouse: { click: vi.fn() },
      keyboard: { press: vi.fn() },
      select: vi.fn(),
    };
    const result = runPreviewSteps(
      page,
      Array.from({ length: 16 }, () => ({
        action: 'assert' as const,
        selector: '#ready',
        visible: true,
      })),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const steps = await result;
    expect(steps).toHaveLength(11);
    expect(steps.slice(0, 10).every((step) => step.ok)).toBe(true);
    expect(steps[10]).toMatchObject({ ok: false, reason: expect.stringContaining('timed out') });
  });
});
