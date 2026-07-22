import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { firmarJWT, tokenGoogle } from './googleAuth.js';

// Clave RSA real para firmar en los tests (la forma y los claims se validan
// decodificando; la FIRMA no se verifica — eso lo hace Google).
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

const decodificar = (seg) => JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));

afterEach(() => vi.unstubAllGlobals());

describe('firmarJWT', () => {
  it('devuelve header.payload.signature con alg RS256 y los claims de service account', () => {
    const jwt = firmarJWT({
      email: 'sync@kamak.iam.gserviceaccount.com',
      key: PEM,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      ahora: 1_760_000_000,
    });
    const partes = jwt.split('.');
    expect(partes).toHaveLength(3);
    expect(decodificar(partes[0])).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodificar(partes[1])).toEqual({
      iss: 'sync@kamak.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_760_000_000,
      exp: 1_760_003_600,          // iat + 1h
    });
    expect(partes[2].length).toBeGreaterThan(0);
    expect(partes[2]).toMatch(/^[A-Za-z0-9_-]+$/);   // base64url sin padding
  });

  it('acepta la PEM con saltos de línea escapados como \\n (como llega en el env de Vercel)', () => {
    const escapada = String(PEM).replace(/\n/g, '\\n');
    const jwt = firmarJWT({ email: 'a@b.iam.gserviceaccount.com', key: escapada, scope: 's' });
    expect(jwt.split('.')).toHaveLength(3);
  });
});

describe('tokenGoogle', () => {
  it('POSTea el JWT al token endpoint (grant jwt-bearer) y devuelve el access_token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'ya29.tok', expires_in: 3599 }) }));
    vi.stubGlobal('fetch', fetchMock);

    const token = await tokenGoogle({ email: 'a@b.iam.gserviceaccount.com', key: PEM, scope: 's' });
    expect(token).toBe('ya29.tok');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(opts.body);
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(params.get('assertion').split('.')).toHaveLength(3);
  });

  it('respuesta no-ok o sin access_token → throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' })));
    await expect(tokenGoogle({ email: 'a@b', key: PEM, scope: 's' })).rejects.toThrow('400');

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await expect(tokenGoogle({ email: 'a@b', key: PEM, scope: 's' })).rejects.toThrow(/sin access_token/);
  });
});
