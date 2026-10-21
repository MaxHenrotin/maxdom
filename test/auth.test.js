import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identify } from '../src/auth.js';

const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud1' };
const CERTS = 'https://team.cloudflareaccess.com/cdn-cgi/access/certs';
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = (json) => base64url(new TextEncoder().encode(JSON.stringify(json)));

async function keyPair(kid) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  return { kid, privateKey, jwk: { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid } };
}

async function sign({ kid, privateKey }, claims) {
  const input = `${encode({ alg: 'RS256', kid })}.${encode(claims)}`;
  return `${input}.${base64url(await crypto.subtle.sign(ALGORITHM, privateKey, new TextEncoder().encode(input)))}`;
}

const request = (token) => new Request('http://localhost/api/shows', { headers: token ? { 'cf-access-jwt-assertion': token } : {} });
const claims = (fields) => ({ aud: ['aud1'], email: 'max@example.com', exp: Math.floor(Date.now() / 1000) + 60, ...fields });

describe('identify', () => {
  let k1;
  let k2;
  let published;
  let fetch;

  beforeEach(async () => {
    k1 ??= await keyPair('k1');
    k2 ??= await keyPair('k2');
    published = [k1];
    fetch = vi.fn(async (url) => (url === CERTS ? Response.json({ keys: published.map((key) => key.jwk) }) : new Response(null, { status: 404 })));
    vi.stubGlobal('fetch', fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns the lowercased email of a valid token', async () => {
    expect(await identify(request(await sign(k1, claims({ email: 'Max@Example.com' }))), env)).toBe('max@example.com');
  });

  it('accepts aud as a string or an array', async () => {
    expect(await identify(request(await sign(k1, claims({ aud: 'aud1' }))), env)).toBe('max@example.com');
    expect(await identify(request(await sign(k1, claims({ aud: ['other', 'aud1'] }))), env)).toBe('max@example.com');
  });

  it('rejects a missing, malformed, expired, wrongly signed or wrong-audience token', async () => {
    const forged = await sign({ kid: 'k1', privateKey: k2.privateKey }, claims());
    const tokens = [
      undefined,
      'not.a.token',
      'garbage',
      await sign(k1, claims({ exp: Math.floor(Date.now() / 1000) - 1 })),
      forged,
      await sign(k1, claims({ aud: ['other'] })),
      await sign(k1, claims({ email: undefined })),
    ];
    for (const token of tokens) expect(await identify(request(token), env)).toBeNull();
  });

  it('fetches the keys again for an unknown kid', async () => {
    await identify(request(await sign(k1, claims())), env);
    published = [k1, k2];
    expect(await identify(request(await sign(k2, claims())), env)).toBe('max@example.com');
  });

  it('uses DEV_EMAIL without a token', async () => {
    expect(await identify(request(), { DEV_EMAIL: 'dev@example.com' })).toBe('dev@example.com');
    expect(fetch).not.toHaveBeenCalled();
  });
});
