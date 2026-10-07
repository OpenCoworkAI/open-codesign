import { initI18n } from '@open-codesign/i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyDesignInBackground } from './system-notifications';

class FakeNotification {
  static created: FakeNotification[] = [];
  onclick: (() => void) | null = null;

  constructor(
    readonly title: string,
    readonly options: { body: string },
  ) {
    FakeNotification.created.push(this);
  }
}

const focusWindow = vi.fn(async () => {});
const switchDesign = vi.fn(async () => {});
let hasFocus = false;
let systemNotifications = true;

function state() {
  return {
    designs: [{ id: 'design-1', name: 'Daymark' }],
    switchDesign,
  } as unknown as Parameters<typeof notifyDesignInBackground>[0];
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  FakeNotification.created = [];
  focusWindow.mockClear();
  switchDesign.mockClear();
  hasFocus = false;
  systemNotifications = true;
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('document', { hasFocus: () => hasFocus });
  vi.stubGlobal('window', {
    codesign: {
      focusWindow,
      preferences: { get: async () => ({ systemNotifications }) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notifyDesignInBackground', () => {
  it('names the design and opens it when clicked', async () => {
    await notifyDesignInBackground(state(), 'design-1', 'done');

    expect(FakeNotification.created).toHaveLength(1);
    const [notification] = FakeNotification.created;
    expect(notification?.title).toBe('Daymark');
    expect(notification?.options.body).toBe('Design ready');

    notification?.onclick?.();
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(switchDesign).toHaveBeenCalledWith('design-1');
  });

  it('uses distinct messages for failures and questions', async () => {
    await notifyDesignInBackground(state(), 'design-1', 'failed');
    await notifyDesignInBackground(state(), 'design-1', 'ask');

    expect(FakeNotification.created.map((n) => n.options.body)).toEqual([
      'Generation failed',
      'Waiting for your answer',
    ]);
  });

  it('stays quiet while the window has focus', async () => {
    hasFocus = true;
    await notifyDesignInBackground(state(), 'design-1', 'done');

    expect(FakeNotification.created).toHaveLength(0);
  });

  it('respects the Advanced setting', async () => {
    systemNotifications = false;
    await notifyDesignInBackground(state(), 'design-1', 'done');

    expect(FakeNotification.created).toHaveLength(0);
  });

  it('falls back to the app name and only focuses for an unknown design', async () => {
    await notifyDesignInBackground(state(), undefined, 'ask');

    const [notification] = FakeNotification.created;
    expect(notification?.title).toBe('Open CoDesign');
    notification?.onclick?.();
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(switchDesign).not.toHaveBeenCalled();
  });
});
