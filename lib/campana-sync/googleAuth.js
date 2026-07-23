// OAuth2 de service account de Google SIN SDK: JWT RS256 firmado con node:crypto
// → access token. Lo usan ga4.js y gsc.js (cada uno con su scope). Requiere una
// service account con acceso de LECTURA a la propiedad GA4 / al sitio de Search
// Console (se la invita por email como a un usuario más).
//
// Env esperado por los llamadores: GOOGLE_SA_EMAIL (xxx@yyy.iam.gserviceaccount.com)
// y GOOGLE_SA_KEY (la private key PEM del JSON de credenciales; puede venir con
// los saltos de línea escapados como "\n" — acá se desescapan).

import { createSign } from 'node:crypto';

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Arma y firma el JWT de service account (RFC 7523). Exportada aparte para
// poder testear la forma header.payload.signature y los claims sin red.
export function firmarJWT({ email, key, scope, ahora = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
  }));
  const pem = String(key).includes('\\n') ? String(key).replace(/\\n/g, '\n') : String(key);
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(pem))}`;
}

// JWT → access token (grant urn:ietf:params:oauth:grant-type:jwt-bearer).
export async function tokenGoogle({ email, key, scope }) {
  const assertion = firmarJWT({ email, key, scope });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!r.ok) throw new Error(`token Google ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!j.access_token) throw new Error('token Google: respuesta sin access_token');
  return j.access_token;
}
