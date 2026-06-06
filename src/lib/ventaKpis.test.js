import { describe, it, expect } from 'vitest';
import { pipelinePonderado, agingDias, debeAvisarFollowup, motivosPerdida, winRatePorResponsable } from './ventaKpis';

const HOY = new Date('2026-06-05T00:00:00Z');

describe('pipelinePonderado', () => {
  it('suma monto × probabilidad por etapa (solo abiertas suman peso)', () => {
    const ops = [{ etapa: 'cotizado', montoUSD: 1000 }, { etapa: 'negociacion', montoUSD: 2000 }, { etapa: 'ganado', montoUSD: 5000 }];
    // 1000*0.40 + 2000*0.70 + 5000*1.0 = 400 + 1400 + 5000 = 6800
    expect(pipelinePonderado(ops)).toBe(6800);
  });
});

describe('agingDias', () => {
  it('días desde fechaCambioEtapa', () => {
    expect(agingDias({ venta: { fechaCambioEtapa: '2026-06-01' } }, HOY)).toBe(4);
  });
  it('sin fecha → null (no se cuenta)', () => {
    expect(agingDias({ venta: {} }, HOY)).toBe(null);
  });
});

describe('debeAvisarFollowup (regla de apagado §8)', () => {
  const base = { estado: 'en-presupuesto', venta: { etapa: 'cotizado', fechaCambioEtapa: '2026-05-01' } };
  it('avisa: cotizado, en-presupuesto, sin ingreso, > N días', () => {
    expect(debeAvisarFollowup(base, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(true);
  });
  it('NO avisa si hay ingreso', () => {
    expect(debeAvisarFollowup(base, { tieneIngreso: true, hoy: HOY, dias: 5 })).toBe(false);
  });
  it('NO avisa si la obra ya no es en-presupuesto', () => {
    expect(debeAvisarFollowup({ ...base, estado: 'activa' }, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(false);
  });
  it('NO avisa si la etapa es ganado/perdido', () => {
    expect(debeAvisarFollowup({ ...base, venta: { etapa: 'ganado' } }, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(false);
  });
  it('NO avisa si lleva pocos días', () => {
    expect(debeAvisarFollowup({ ...base, venta: { etapa: 'cotizado', fechaCambioEtapa: '2026-06-03' } }, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(false);
  });
});

describe('motivosPerdida', () => {
  it('rankea los motivos de las perdidas', () => {
    const obras = [
      { estado: 'archivada', venta: { etapa: 'perdido', motivoPerdida: 'precio' } },
      { estado: 'archivada', venta: { etapa: 'perdido', motivoPerdida: 'precio' } },
      { estado: 'archivada', venta: { etapa: 'perdido', motivoPerdida: 'otro proveedor' } },
    ];
    const r = motivosPerdida(obras);
    expect(r[0]).toEqual({ motivo: 'precio', count: 2 });
  });
});

describe('winRatePorResponsable', () => {
  it('cuenta ganadas/cerradas por responsable', () => {
    const ops = [
      { responsable: 'u1', etapa: 'ganado' }, { responsable: 'u1', etapa: 'perdido' },
      { responsable: 'u2', etapa: 'ganado' },
    ];
    const r = winRatePorResponsable(ops);
    expect(r.u1).toEqual({ ganadas: 1, perdidas: 1, winRate: 50 });
    expect(r.u2.winRate).toBe(100);
  });
});
