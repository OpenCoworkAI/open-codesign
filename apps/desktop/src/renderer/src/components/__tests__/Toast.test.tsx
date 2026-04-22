import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../../store';
import { AUTO_DISMISS_MS, scheduleAutoDismiss } from '../Toast';

describe('Toast auto-dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses success toasts after 5s', () => {
    const onDismiss = vi.fn();
    scheduleAutoDismiss('success', onDismiss);
    vi.advanceTimersByTime(4999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses info toasts after 5s', () => {
    const onDismiss = vi.fn();
    scheduleAutoDismiss('info', onDismiss);
    vi.advanceTimersByTime(5000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss error toasts', () => {
    const onDismiss = vi.fn();
    const cleanup = scheduleAutoDismiss('error', onDismiss);
    expect(cleanup).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('cleanup cancels the pending timer', () => {
    const onDismiss = vi.fn();
    const cleanup = scheduleAutoDismiss('success', onDismiss);
    expect(cleanup).not.toBeNull();
    cleanup?.();
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('exposes 5s for non-error variants and null for error', () => {
    expect(AUTO_DISMISS_MS.success).toBe(5000);
    expect(AUTO_DISMISS_MS.info).toBe(5000);
    expect(AUTO_DISMISS_MS.error).toBeNull();
  });
});

describe('pushToast always registers a ReportableError for error toasts', () => {
  beforeEach(() => {
    useCodesignStore.setState({ toasts: [], reportableErrors: [] });
  });

  it('error toast without an explicit localId gets one minted from the store', () => {
    useCodesignStore.getState().pushToast({
      variant: 'error',
      title: 'Boom',
      description: 'Something broke',
    });
    const toasts = useCodesignStore.getState().toasts;
    const errors = useCodesignStore.getState().reportableErrors;
    expect(toasts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(toasts[0]?.localId).toBe(errors[0]?.localId);
    expect(errors[0]?.code).toBe('RENDERER_ERROR');
    expect(errors[0]?.message).toBe('Something broke');
  });

  it('info toasts do not register a ReportableError', () => {
    useCodesignStore.getState().pushToast({ variant: 'info', title: 'hello' });
    expect(useCodesignStore.getState().reportableErrors).toHaveLength(0);
  });
});
