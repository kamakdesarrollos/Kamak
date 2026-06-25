import { describe, it, expect } from 'vitest';
import { EVENTOS, resolverDestinatarios, noLeidaPara } from './notificaciones';

describe('EVENTOS config', () => {
  it('todo tipo tiene roles (array), titulo(fn) y link', () => {
    for (const [tipo, cfg] of Object.entries(EVENTOS)) {
      expect(Array.isArray(cfg.roles), `${tipo}.roles`).toBe(true);
      expect(typeof cfg.titulo, `${tipo}.titulo`).toBe('function');
      expect(cfg.link, `${tipo}.link`).toBeTruthy();
    }
  });
  it('solicitud_eliminacion avisa a Admin', () => {
    expect(EVENTOS.solicitud_eliminacion.roles).toContain('Admin');
  });
});

describe('resolverDestinatarios', () => {
  const usuarios = [
    { id: 'u1', rol: 'Admin' },
    { id: 'u2', rol: 'Administración' },
    { id: 'u3', rol: 'Admin' },
    { id: 'u4', rol: 'Jefe de obra' },
  ];
  it('devuelve los userIds de los roles pedidos, sin duplicados', () => {
    expect(resolverDestinatarios({ roles: ['Admin'] }, usuarios, null).sort()).toEqual(['u1', 'u3']);
  });
  it('excluye al actor (no auto-notificar)', () => {
    expect(resolverDestinatarios({ roles: ['Admin'] }, usuarios, 'u1')).toEqual(['u3']);
  });
  it('soporta userIds explícitos además de roles', () => {
    expect(resolverDestinatarios({ roles: [], userIds: ['u4'] }, usuarios, null)).toEqual(['u4']);
  });
  it('dedup entre roles y userIds', () => {
    expect(resolverDestinatarios({ roles: ['Admin'], userIds: ['u1'] }, usuarios, null).sort()).toEqual(['u1', 'u3']);
  });
  it('lista vacía si no matchea nada', () => {
    expect(resolverDestinatarios({ roles: ['NoExiste'] }, usuarios, null)).toEqual([]);
  });
});

describe('noLeidaPara', () => {
  it('true si el userId no está en leidaPor', () => {
    expect(noLeidaPara({ leidaPor: ['u2'] }, 'u1')).toBe(true);
  });
  it('false si ya la leyó', () => {
    expect(noLeidaPara({ leidaPor: ['u1', 'u2'] }, 'u1')).toBe(false);
  });
  it('true si leidaPor falta', () => {
    expect(noLeidaPara({}, 'u1')).toBe(true);
  });
});
