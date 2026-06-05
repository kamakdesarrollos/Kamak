import { describe, it, expect } from 'vitest';
import { derivaClienteEstado } from './derivaClienteEstado';

const HOY = new Date('2026-06-05T00:00:00Z');

describe('derivaClienteEstado', () => {
  it("'cliente' si tiene al menos una obra ganada (activa/finalizada/pausada)", () => {
    expect(derivaClienteEstado({}, [{ estado: 'activa' }], null, { hoy: HOY })).toBe('cliente');
    expect(derivaClienteEstado({}, [{ estado: 'en-presupuesto' }, { estado: 'finalizada' }], null, { hoy: HOY })).toBe('cliente');
  });

  it("'prospecto' si sólo tiene obras en-presupuesto (oportunidades abiertas)", () => {
    expect(derivaClienteEstado({}, [{ estado: 'en-presupuesto' }], null, { hoy: HOY })).toBe('prospecto');
  });

  it("'prospecto' si no tiene obras pero hay actividad reciente", () => {
    expect(derivaClienteEstado({}, [], '2026-05-20', { hoy: HOY })).toBe('prospecto');
  });

  it("'inactivo' si no tiene obra ganada ni abierta y la última señal es vieja (> meses)", () => {
    // obra archivada (perdida) hace 1 año, sin actividad
    expect(derivaClienteEstado({}, [{ estado: 'archivada', createdAt: '2025-05-01' }], null, { hoy: HOY })).toBe('inactivo');
  });

  it("un inactivo vuelve a 'prospecto' al recibir actividad reciente", () => {
    expect(derivaClienteEstado({}, [{ estado: 'archivada', createdAt: '2025-05-01' }], '2026-06-01', { hoy: HOY })).toBe('prospecto');
  });

  it('sin obras ni actividad => prospecto (cliente nuevo)', () => {
    expect(derivaClienteEstado({}, [], null, { hoy: HOY })).toBe('prospecto');
  });
});
