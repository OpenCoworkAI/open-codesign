import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CallbackServer, startCallbackServer } from './oauth-server.js';

const servers: CallbackServer[] = [];

async function track(server: CallbackServer): Promise<CallbackServer> {
  servers.push(server);
  return server;
}

afterEach(() => {
  while (servers.length > 0) {
    const s = servers.pop();
    try {
      s?.close();
    } catch {
      // ignore
    }
  }
  vi.useRealTimers();
});

function portOf(redirectUri: string): number {
  const url = new URL(redirectUri);
  return Number(url.port);
}

describe('startCallbackServer', () => {
  it('exposes redirectUri with a numeric port', async () => {
    const server = await track(await startCallbackServer(0));
    expect(server.redirectUri).toMatch(/^http:\/\/localhost:\d+\/auth\/callback$/);
    expect(portOf(server.redirectUri)).toBeGreaterThan(0);
  });

  it('resolves waitForCode on a successful callback', async () => {
    const server = await track(await startCallbackServer(0));
    const waiter = server.waitForCode('expected-state');
    const res = await fetch(`${server.redirectUri}?code=AAA&state=expected-state`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('登录成功');
    await expect(waiter).resolves.toEqual({ code: 'AAA', state: 'expected-state' });
  });

  it('rejects when state does not match', async () => {
    const server = await track(await startCallbackServer(0));
    const waiter = server.waitForCode('foo');
    const assertion = expect(waiter).rejects.toThrow(/state mismatch/);
    const res = await fetch(`${server.redirectUri}?code=X&state=bar`);
    expect(res.status).toBe(400);
    await assertion;
  });

  it('rejects when the provider returned an error', async () => {
    const server = await track(await startCallbackServer(0));
    const waiter = server.waitForCode('s');
    const assertion = expect(waiter).rejects.toThrow(/access_denied/);
    const res = await fetch(
      `${server.redirectUri}?error=access_denied&error_description=user%20cancelled&state=s`,
    );
    expect(res.status).toBe(400);
    await assertion;
  });

  it('escapes HTML in error params on the error page', async () => {
    const server = await track(await startCallbackServer(0));
    const waiter = server.waitForCode('s');
    const assertion = expect(waiter).rejects.toThrow(/<script>alert\(1\)<\/script>/);
    const res = await fetch(
      `${server.redirectUri}?error=${encodeURIComponent('<script>alert(1)</script>')}&error_description=${encodeURIComponent('pwned')}&state=s`,
    );
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).not.toContain('<script>alert(1)</script>');
    await assertion;
  });

  it('rejects when code is missing', async () => {
    const server = await track(await startCallbackServer(0));
    const waiter = server.waitForCode('foo');
    const assertion = expect(waiter).rejects.toThrow(/missing code/);
    const res = await fetch(`${server.redirectUri}?state=foo`);
    expect(res.status).toBe(400);
    await assertion;
  });

  it('rejects after the 2-minute timeout', async () => {
    vi.useFakeTimers();
    const server = await track(await startCallbackServer(0));
    const waiter = server.waitForCode('foo');
    const assertion = expect(waiter).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1000);
    await assertion;
  });

  it('rejects when aborted mid-wait', async () => {
    const server = await track(await startCallbackServer(0));
    const controller = new AbortController();
    const waiter = server.waitForCode('foo', controller.signal);
    controller.abort();
    await expect(waiter).rejects.toThrow(/aborted/);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const server = await track(await startCallbackServer(0));
    const controller = new AbortController();
    controller.abort();
    await expect(server.waitForCode('foo', controller.signal)).rejects.toThrow(/aborted/);
  });

  it('rejects pending waiter when close() is called', async () => {
    const server = await startCallbackServer(0);
    const waiter = server.waitForCode('foo');
    server.close();
    await expect(waiter).rejects.toThrow(/server closed/);
  });

  it('rejects a second concurrent waitForCode', async () => {
    const server = await track(await startCallbackServer(0));
    const first = server.waitForCode('foo');
    await expect(server.waitForCode('bar')).rejects.toThrow(/already pending/);
    // settle the first so afterEach is clean
    server.close();
    await expect(first).rejects.toThrow();
  });

  it('returns 404 for unknown paths', async () => {
    const server = await track(await startCallbackServer(0));
    const res = await fetch(`http://localhost:${portOf(server.redirectUri)}/foo`);
    expect(res.status).toBe(404);
  });

  it('throws an actionable Chinese error when the preferred port is occupied', async () => {
    const first = await track(await startCallbackServer(0));
    const busyPort = portOf(first.redirectUri);
    await expect(startCallbackServer(busyPort)).rejects.toThrow(/已被占用/);
  });
});
