const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const decode = (part) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(decode(part)));

// Access rotates its signing keys, so an unknown kid triggers a fresh download.
let keys = new Map();
async function accessKey(teamDomain, kid) {
  if (!keys.has(kid)) {
    const { keys: jwks } = await (await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)).json();
    keys = new Map(await Promise.all(jwks.map(async (jwk) => [jwk.kid, await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['verify'])])));
  }
  return keys.get(kid);
}

// The email Cloudflare Access logged in, read from its signed token. DEV_EMAIL stands in
// for it under `wrangler dev`, where there is no Access; it must never be set in production.
export async function identify(request, env, now = Date.now()) {
  if (env.DEV_EMAIL) return env.DEV_EMAIL.toLowerCase();
  try {
    const [header, payload, signature] = request.headers.get('cf-access-jwt-assertion').split('.');
    const key = await accessKey(env.ACCESS_TEAM_DOMAIN, decodeJson(header).kid);
    if (!key || !(await crypto.subtle.verify(ALGORITHM, key, decode(signature), new TextEncoder().encode(`${header}.${payload}`)))) return null;
    const { aud, exp, email } = decodeJson(payload);
    if (![aud].flat().includes(env.ACCESS_AUD) || exp * 1000 <= now || typeof email !== 'string') return null;
    return email.toLowerCase();
  } catch {
    return null;
  }
}
