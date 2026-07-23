import { describe, it, expect } from 'vitest';
import { operadoresMatcheados, actividadLeadWeb, patchOperadorRespondio, ETAPAS_PISABLES } from './campanasMatch.js';

describe('operadoresMatcheados', () => {
  it('deduplica por operador y conserva la PRIMERA estación de cada uno', () => {
    const r = operadoresMatcheados([
      { id: 'est-1', operador_id: 'op-1' },
      { id: 'est-2', operador_id: 'op-1' },   // mismo operador, otra estación
      { id: 'est-3', operador_id: 'op-2' },
    ]);
    expect(r).toEqual([
      { operadorId: 'op-1', estacionId: 'est-1' },
      { operadorId: 'op-2', estacionId: 'est-3' },
    ]);
  });
  it('saltea filas sin operador_id y tolera nulls', () => {
    const r = operadoresMatcheados([
      { id: 'est-1', operador_id: null },
      null,
      { id: 'est-2', operador_id: 'op-9' },
    ]);
    expect(r).toEqual([{ operadorId: 'op-9', estacionId: 'est-2' }]);
  });
  it('lista vacía / undefined → []', () => {
    expect(operadoresMatcheados([])).toEqual([]);
    expect(operadoresMatcheados(undefined)).toEqual([]);
  });
});

describe('actividadLeadWeb', () => {
  it('arma el payload de camp_actividades con usuario sistema y el id del lead', () => {
    const p = actividadLeadWeb({ operadorId: 'op-1', estacionId: 'est-1', leadId: 'obra-123', nowISO: '2026-07-22T10:00:00.000Z' });
    expect(p).toEqual({
      operador_id: 'op-1',
      estacion_id: 'est-1',
      tipo: 'nota',
      canal: 'otro',
      texto: 'Respondió por el form de la web (lead obra-123)',
      usuario: 'sistema',
      fecha: '2026-07-22T10:00:00.000Z',
    });
  });
  it('sin estación → estacion_id null (actividad colgada solo del operador)', () => {
    const p = actividadLeadWeb({ operadorId: 'op-1', leadId: 'x', nowISO: 'now' });
    expect(p.estacion_id).toBeNull();
  });
});

describe('patchOperadorRespondio / ETAPAS_PISABLES', () => {
  it('el patch sube a respondio y setea updated_at (no hay trigger en la DB)', () => {
    expect(patchOperadorRespondio('2026-07-22T10:00:00.000Z'))
      .toEqual({ etapa_prospeccion: 'respondio', updated_at: '2026-07-22T10:00:00.000Z' });
  });
  it('solo se pisan las etapas tempranas (nunca degradar una avanzada)', () => {
    expect(ETAPAS_PISABLES).toEqual(['sin_contactar', 'contactado']);
  });
});
