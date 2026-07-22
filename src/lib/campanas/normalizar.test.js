import { describe, it, expect } from 'vitest';
import {
  ESTADOS_LLAMADA, ESTADO_LLAMADA_META,
  ETAPAS_PROSPECCION, ETAPA_PROSPECCION_META,
  BANDERAS, CANALES,
} from './constants.js';
import { normalizarEstado, normalizarTelefonoAR, esEstadoConocido } from './normalizar.js';

describe('constants — datos canónicos del módulo campañas', () => {
  it('ESTADOS_LLAMADA: los 9 canónicos en orden', () => {
    expect(ESTADOS_LLAMADA).toEqual([
      'SIN LLAMAR', 'FUERA DE SERVICIO', 'NO ATIENDE', 'VOLVER A LLAMAR',
      'PASÓ MAIL', 'PASÓ WHATSAPP', 'DECISOR IDENTIFICADO', 'NO INTERESA', 'LEAD CALIENTE',
    ]);
  });
  it('ESTADO_LLAMADA_META: {label,color} para cada estado, colores hex distintos', () => {
    for (const e of ESTADOS_LLAMADA) {
      expect(ESTADO_LLAMADA_META[e], `falta meta de ${e}`).toBeTruthy();
      expect(typeof ESTADO_LLAMADA_META[e].label).toBe('string');
      expect(ESTADO_LLAMADA_META[e].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const colores = ESTADOS_LLAMADA.map((e) => ESTADO_LLAMADA_META[e].color);
    expect(new Set(colores).size).toBe(ESTADOS_LLAMADA.length);
  });
  it('ETAPAS_PROSPECCION: las 7 etapas del kanban en orden', () => {
    expect(ETAPAS_PROSPECCION).toEqual([
      'sin_contactar', 'contactado', 'respondio', 'en_conversacion',
      'reunion', 'promovido', 'descartado',
    ]);
  });
  it('ETAPA_PROSPECCION_META: {label,color} para cada etapa', () => {
    for (const e of ETAPAS_PROSPECCION) {
      expect(ETAPA_PROSPECCION_META[e], `falta meta de ${e}`).toBeTruthy();
      expect(typeof ETAPA_PROSPECCION_META[e].label).toBe('string');
      expect(ETAPA_PROSPECCION_META[e].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('BANDERAS: las 12 reales + Otra', () => {
    expect(BANDERAS).toEqual([
      'YPF', 'Shell', 'Axion', 'Puma', 'ACA', 'Gulf', 'Refinor',
      'Voy con Energía', 'Dapsa', 'Wico', 'Rhasa', 'Líder Oil', 'Otra',
    ]);
  });
  it('CANALES: los 6 canales de contacto', () => {
    expect(CANALES).toEqual(['llamada', 'email', 'linkedin', 'whatsapp', 'presencial', 'otro']);
  });
});

describe('normalizarEstado — estados sucios de la planilla → canónico + original', () => {
  it('variantes de "pasó mail" de Caro → PASÓ MAIL, original tal cual', () => {
    expect(normalizarEstado('ME PASO EL MAIL')).toEqual({
      estado: 'PASÓ MAIL', original: 'ME PASO EL MAIL', flags: {},
    });
    expect(normalizarEstado('PASO MAIL').estado).toBe('PASÓ MAIL');
    expect(normalizarEstado('ME PASÓ EL MAIL').estado).toBe('PASÓ MAIL');
    expect(normalizarEstado('PASO EL MAIL').estado).toBe('PASÓ MAIL');
  });
  it('variantes de whatsapp → PASÓ WHATSAPP', () => {
    expect(normalizarEstado('PASO WHATSAPP').estado).toBe('PASÓ WHATSAPP');
    expect(normalizarEstado('ME PASO WHATSAPP').estado).toBe('PASÓ WHATSAPP');
  });
  it('número equivocado (con y sin tilde) → FUERA DE SERVICIO', () => {
    expect(normalizarEstado('NUMERO EQUIVOCADO')).toEqual({
      estado: 'FUERA DE SERVICIO', original: 'NUMERO EQUIVOCADO', flags: {},
    });
    expect(normalizarEstado('NÚMERO EQUIVOCADO').estado).toBe('FUERA DE SERVICIO');
  });
  it('teléfono fijo: es atributo, no estado → SIN LLAMAR + flag telefonoFijo', () => {
    expect(normalizarEstado('TELEFONO FIJO')).toEqual({
      estado: 'SIN LLAMAR', original: 'TELEFONO FIJO', flags: { telefonoFijo: true },
    });
    expect(normalizarEstado('TELÉFONO FIJO').flags).toEqual({ telefonoFijo: true });
  });
  it('canónicos pasan igual, case-insensitive y sin tildes', () => {
    expect(normalizarEstado('lead caliente').estado).toBe('LEAD CALIENTE');
    expect(normalizarEstado('PASÓ MAIL').estado).toBe('PASÓ MAIL');
    expect(normalizarEstado('no atiende').estado).toBe('NO ATIENDE');
    expect(normalizarEstado('decisor identificado').estado).toBe('DECISOR IDENTIFICADO');
    expect(normalizarEstado('  volver  a llamar  ').estado).toBe('VOLVER A LLAMAR');
  });
  it('vacío / null / undefined → SIN LLAMAR', () => {
    expect(normalizarEstado('')).toEqual({ estado: 'SIN LLAMAR', original: '', flags: {} });
    expect(normalizarEstado(null)).toEqual({ estado: 'SIN LLAMAR', original: null, flags: {} });
    expect(normalizarEstado(undefined)).toEqual({ estado: 'SIN LLAMAR', original: null, flags: {} });
    expect(normalizarEstado('   ').estado).toBe('SIN LLAMAR');
  });
  it('desconocido no-vacío → SIN LLAMAR con original preservado', () => {
    expect(normalizarEstado('HABLE CON EL CONTADOR')).toEqual({
      estado: 'SIN LLAMAR', original: 'HABLE CON EL CONTADOR', flags: {},
    });
  });
});

describe('esEstadoConocido — reconocimiento para heurística de columnas', () => {
  it('canónicos y variantes conocidas → true', () => {
    expect(esEstadoConocido('NO ATIENDE')).toBe(true);
    expect(esEstadoConocido('ME PASO EL MAIL')).toBe(true);
    expect(esEstadoConocido('numero equivocado')).toBe(true);
    expect(esEstadoConocido('telefono fijo')).toBe(true);
  });
  it('texto libre / vacío → false', () => {
    expect(esEstadoConocido('llamar la semana que viene')).toBe(false);
    expect(esEstadoConocido('')).toBe(false);
    expect(esEstadoConocido(null)).toBe(false);
  });
});

describe('normalizarTelefonoAR — E.164 sin "+" para dedup', () => {
  it('formato viejo con 15 tras el área: 02262-15-530944 → celular 549', () => {
    expect(normalizarTelefonoAR('02262-15-530944')).toBe('5492262530944');
  });
  it('internacional con 9 explícito: +54 9 11 5555-4433', () => {
    expect(normalizarTelefonoAR('+54 9 11 5555-4433')).toBe('5491155554433');
  });
  it('fijo de CABA: 011 4444-5555 → 54 sin 9', () => {
    expect(normalizarTelefonoAR('011 4444-5555')).toBe('541144445555');
  });
  it('10 dígitos sin 0 ni 15 (ambiguo) → fijo con área', () => {
    expect(normalizarTelefonoAR('2262530944')).toBe('542262530944');
  });
  it('área de 3 dígitos con 15: (0221) 15-444-5566 → celular', () => {
    expect(normalizarTelefonoAR('(0221) 15-444-5566')).toBe('5492214445566');
  });
  it('con prefijo 54 sin "+" ni 9 → fijo', () => {
    expect(normalizarTelefonoAR('54 11 4444 5555')).toBe('541144445555');
  });
  it('ya normalizado E.164 → idempotente', () => {
    expect(normalizarTelefonoAR('5492262530944')).toBe('5492262530944');
    expect(normalizarTelefonoAR('542262530944')).toBe('542262530944');
  });
  it('basura y vacíos → null', () => {
    expect(normalizarTelefonoAR('sin telefono')).toBe(null);
    expect(normalizarTelefonoAR('')).toBe(null);
    expect(normalizarTelefonoAR(null)).toBe(null);
    expect(normalizarTelefonoAR(undefined)).toBe(null);
    expect(normalizarTelefonoAR('12345')).toBe(null);
  });
});
