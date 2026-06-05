import { describe, it, expect } from 'vitest';
import {
  obraEstadoParaEtapa, etapaEfectiva, etapaInicialBackfill,
  necesitaGanarPorPago, resumenEmbudo, ETAPA_META,
  visibleEnEmbudo, esArrastrableEnEmbudo,
} from './ventaEtapa';

describe('obraEstadoParaEtapa', () => {
  it('ganado -> activa (salvo que ya estuviera finalizada)', () => {
    expect(obraEstadoParaEtapa('ganado', 'en-presupuesto')).toBe('activa');
    expect(obraEstadoParaEtapa('ganado', 'finalizada')).toBe('finalizada');
  });
  it('perdido -> archivada', () => {
    expect(obraEstadoParaEtapa('perdido', 'activa')).toBe('archivada');
  });
  it('etapas abiertas -> en-presupuesto (reabre si venía cerrada)', () => {
    expect(obraEstadoParaEtapa('cotizado', 'activa')).toBe('en-presupuesto');
    expect(obraEstadoParaEtapa('prospecto', 'en-presupuesto')).toBe('en-presupuesto');
  });
});

describe('etapaEfectiva', () => {
  it('obra activa => ganado', () => {
    expect(etapaEfectiva({ estado: 'activa' })).toBe('ganado');
  });
  it('en-presupuesto con pago => ganado', () => {
    expect(etapaEfectiva({ estado: 'en-presupuesto' }, { cobradoUSD: 500 })).toBe('ganado');
  });
  it('en-presupuesto sin pago usa la etapa guardada', () => {
    expect(etapaEfectiva({ estado: 'en-presupuesto', venta: { etapa: 'negociacion' } })).toBe('negociacion');
  });
  it('en-presupuesto sin etapa => prospecto', () => {
    expect(etapaEfectiva({ estado: 'en-presupuesto' })).toBe('prospecto');
  });
  it('archivada sin etapa => perdido; con etapa guardada la respeta', () => {
    expect(etapaEfectiva({ estado: 'archivada' })).toBe('perdido');
    expect(etapaEfectiva({ estado: 'archivada', venta: { etapa: 'ganado' } })).toBe('ganado');
  });
  it('activa marcada perdido se respeta como perdido', () => {
    expect(etapaEfectiva({ estado: 'activa', venta: { etapa: 'perdido' } })).toBe('perdido');
  });
  it('obra nula => prospecto', () => {
    expect(etapaEfectiva(null)).toBe('prospecto');
  });
});

describe('etapaInicialBackfill', () => {
  it('activa/finalizada => ganado', () => {
    expect(etapaInicialBackfill({ estado: 'activa' })).toBe('ganado');
    expect(etapaInicialBackfill({ estado: 'finalizada' })).toBe('ganado');
  });
  it('archivada con ingreso => ganado; sin ingreso => perdido', () => {
    expect(etapaInicialBackfill({ estado: 'archivada' }, { tieneIngreso: true })).toBe('ganado');
    expect(etapaInicialBackfill({ estado: 'archivada' }, { tieneIngreso: false })).toBe('perdido');
  });
  it('en-presupuesto: cotizado si propuesta enviada, sino prospecto', () => {
    expect(etapaInicialBackfill({ estado: 'en-presupuesto' }, { propuestaEnviada: true })).toBe('cotizado');
    expect(etapaInicialBackfill({ estado: 'en-presupuesto' }, { propuestaEnviada: false })).toBe('prospecto');
  });
});

describe('necesitaGanarPorPago', () => {
  it('true si hay pago y la etapa no es ganado/perdido', () => {
    expect(necesitaGanarPorPago({ venta: { etapa: 'cotizado' } }, 100)).toBe(true);
    expect(necesitaGanarPorPago({ estado: 'en-presupuesto' }, 100)).toBe(true);
  });
  it('false si no hay pago, o ya es ganado/perdido', () => {
    expect(necesitaGanarPorPago({ venta: { etapa: 'cotizado' } }, 0)).toBe(false);
    expect(necesitaGanarPorPago({ venta: { etapa: 'ganado' } }, 100)).toBe(false);
    expect(necesitaGanarPorPago({ venta: { etapa: 'perdido' } }, 100)).toBe(false);
  });
});

describe('resumenEmbudo', () => {
  it('cuenta por etapa y calcula conversión = ganado / (ganado+perdido)', () => {
    const r = resumenEmbudo(['prospecto', 'cotizado', 'ganado', 'ganado', 'perdido']);
    expect(r.conteo.ganado).toBe(2);
    expect(r.conteo.perdido).toBe(1);
    expect(r.cerradas).toBe(3);
    expect(r.conversion).toBe(67); // 2/3
    expect(r.abiertas).toBe(2);
  });
  it('sin cerradas, conversión = 0', () => {
    expect(resumenEmbudo(['prospecto']).conversion).toBe(0);
  });
});

describe('ETAPA_META', () => {
  it('tiene label y color para las 5 etapas', () => {
    for (const e of ['prospecto', 'cotizado', 'negociacion', 'ganado', 'perdido']) {
      expect(ETAPA_META[e].label).toBeTruthy();
      expect(ETAPA_META[e].color).toMatch(/^#/);
    }
  });
});

describe('visibleEnEmbudo', () => {
  it('oculta las obras terminadas (finalizada)', () => {
    expect(visibleEnEmbudo({ estado: 'finalizada' })).toBe(false);
  });
  it('muestra el resto (en-presupuesto, activa, pausada, archivada)', () => {
    expect(visibleEnEmbudo({ estado: 'en-presupuesto' })).toBe(true);
    expect(visibleEnEmbudo({ estado: 'activa' })).toBe(true);
    expect(visibleEnEmbudo({ estado: 'pausada' })).toBe(true);
    expect(visibleEnEmbudo({ estado: 'archivada' })).toBe(true);
  });
  it('obra nula no es visible', () => {
    expect(visibleEnEmbudo(null)).toBe(false);
  });
});

describe('esArrastrableEnEmbudo', () => {
  it('solo las oportunidades abiertas (en-presupuesto) se pueden arrastrar', () => {
    expect(esArrastrableEnEmbudo({ estado: 'en-presupuesto' })).toBe(true);
  });
  it('una obra confirmada (activa/finalizada) NO se arrastra: revertirla a presupuesto desconfirmaría una obra real', () => {
    expect(esArrastrableEnEmbudo({ estado: 'activa' })).toBe(false);
    expect(esArrastrableEnEmbudo({ estado: 'finalizada' })).toBe(false);
  });
  it('una obra perdida/archivada tampoco se arrastra desde el board', () => {
    expect(esArrastrableEnEmbudo({ estado: 'archivada' })).toBe(false);
  });
  it('obra nula no es arrastrable', () => {
    expect(esArrastrableEnEmbudo(null)).toBe(false);
  });
});
