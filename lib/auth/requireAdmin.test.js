import { describe, it, expect } from 'vitest';
import { getBearerToken, verifyAdmin } from './requireAdmin.js';

// fetch falso que rutea por URL: /auth/v1/user (validación del JWT) y
// /rest/v1/app_users (consulta del rol). `cfg` define qué responde cada uno.
function fakeFetch(cfg) {
  return async (url) => {
    if (url.includes('/auth/v1/user')) {
      return cfg.authOk
        ? { ok: true, json: async () => ({ email: cfg.email, id: 'uid-1' }) }
        : { ok: false, json: async () => ({}) };
    }
    if (url.includes('/rest/v1/app_users')) {
      return cfg.rolOk === false
        ? { ok: false, json: async () => ([]) }
        : { ok: true, json: async () => (cfg.rolRows ?? []) };
    }
    throw new Error('URL inesperada: ' + url);
  };
}

const ENV = { supabaseUrl: 'https://x.supabase.co', serviceKey: 'svc' };

describe('getBearerToken', () => {
  it('extrae el token de "Bearer <x>" (case-insensitive)', () => {
    expect(getBearerToken({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe('abc.def.ghi');
    expect(getBearerToken({ headers: { Authorization: 'bearer xyz' } })).toBe('xyz');
  });
  it('devuelve null sin header o mal formado', () => {
    expect(getBearerToken({ headers: {} })).toBeNull();
    expect(getBearerToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(getBearerToken({})).toBeNull();
  });
});

describe('verifyAdmin', () => {
  it('500 si falta configuración del servidor', async () => {
    const r = await verifyAdmin({ token: 't', supabaseUrl: '', serviceKey: '' });
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it('401 si no hay token', async () => {
    const r = await verifyAdmin({ ...ENV, token: null, fetchImpl: fakeFetch({}) });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('401 si el JWT es inválido/expirado', async () => {
    const r = await verifyAdmin({ ...ENV, token: 't', fetchImpl: fakeFetch({ authOk: false }) });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('403 si el usuario no está en app_users (sin rol)', async () => {
    const r = await verifyAdmin({ ...ENV, token: 't', fetchImpl: fakeFetch({ authOk: true, email: 'x@y.com', rolRows: [] }) });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('403 si el rol no es Admin', async () => {
    const r = await verifyAdmin({ ...ENV, token: 't', fetchImpl: fakeFetch({ authOk: true, email: 'x@y.com', rolRows: [{ rol: 'Comprador' }] }) });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('ok + user si la sesión es válida y el rol es Admin', async () => {
    const r = await verifyAdmin({ ...ENV, token: 't', fetchImpl: fakeFetch({ authOk: true, email: 'admin@kamak.com', rolRows: [{ rol: 'Admin' }] }) });
    expect(r.ok).toBe(true);
    expect(r.user).toMatchObject({ email: 'admin@kamak.com', rol: 'Admin' });
  });
});
