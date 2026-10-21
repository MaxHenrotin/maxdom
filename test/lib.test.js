import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lib.js keeps its cache at module level, so each test loads a fresh copy.
let api;
beforeEach(async () => {
  vi.resetModules();
  ({ api } = await import('../public/lib.js'));
});

afterEach(() => vi.unstubAllGlobals());

// Answers every request with a counter, so two reads that reached the server differ.
function stubServer() {
  let calls = 0;
  const fetch = vi.fn(async () => Response.json({ calls: ++calls }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('api', () => {
  it('reads a path from the server once', async () => {
    const fetch = stubServer();
    expect(await api('/shows')).toEqual(await api('/shows'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads again after a write', async () => {
    const fetch = stubServer();
    await api('/shows');
    await api('/watched', { method: 'POST', body: {} });
    await api('/shows');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("doesn't keep a read that a write overtook", async () => {
    let answerRead;
    vi.stubGlobal('fetch', vi.fn(async (path, { method }) => {
      if (method === 'GET') return new Promise((resolve) => { answerRead = () => resolve(Response.json({ stale: true })); });
      return Response.json({ ok: true });
    }));
    const read = api('/shows');
    await api('/watched', { method: 'POST', body: {} });
    answerRead();
    await read;
    const fetch = stubServer();
    await api('/shows');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("doesn't keep an error", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'down' }, { status: 503 })));
    await expect(api('/shows')).rejects.toThrow('down');
    const fetch = stubServer();
    await api('/shows');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
