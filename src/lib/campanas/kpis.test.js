import { describe, it, expect } from 'vitest';
import { kpisGenerales, comparativaListas, embudoConcrecion, seriePorSemana, statsLlamadasCaro } from './kpis';

// ─── Dataset fijo ────────────────────────────────────────────────────────────
// AHORA = miércoles 2026-07-22 15:00 hora LOCAL (sin Z → independiente del TZ).
// Lunes de la semana actual: 2026-07-20. Semanas previas: 07-13, 07-06, 06-29.
const AHORA = new Date('2026-07-22T15:00:00');

const CONTEO = {
  sin_contactar: 40,
  contactado: 12,
  respondio: 6,
  en_conversacion: 4,
  reunion: 3,
  promovido: 2,
  descartado: 3,
};

const ESTACIONES_STATS = { porEstado: { 'LEAD CALIENTE': 5, 'NO ATIENDE': 11 } };

// 21 actividades. Fechas relativas a AHORA:
//   hoy = 2026-07-22 · ayer = 07-21 · hace 5 días = 07-17 · hace 8 días = 07-14 (fuera de semana)
const ACTIVIDADES = [
  // llamadas de Caro (usuario_id 'caro')
  { id: 'a1', tipo: 'llamada', canal: 'llamada', usuario_id: 'caro', operador_id: 'op1', fecha: '2026-07-22T09:00:00', resultado: 'NO ATIENDE' },
  { id: 'a2', tipo: 'llamada', canal: 'llamada', usuario_id: 'caro', operador_id: 'op2', fecha: '2026-07-22T10:30:00', resultado: 'PASÓ MAIL' },
  { id: 'a3', tipo: 'llamada', canal: 'llamada', usuario_id: 'caro', operador_id: 'op3', fecha: '2026-07-21T11:00:00', resultado: 'NO ATIENDE' },
  { id: 'a4', tipo: 'llamada', canal: 'llamada', usuario_id: 'caro', operador_id: 'op4', fecha: '2026-07-17T10:00:00', resultado: 'LEAD CALIENTE' },
  { id: 'a5', tipo: 'llamada', canal: 'llamada', usuario_id: 'caro', operador_id: 'op5', fecha: '2026-07-14T10:00:00', resultado: 'NO INTERESA' }, // hace 8 días → fuera de semana
  // llamada de otro usuario, hoy
  { id: 'a6', tipo: 'llamada', canal: 'llamada', usuario_id: 'franco', operador_id: 'op6', fecha: '2026-07-22T12:00:00', resultado: 'VOLVER A LLAMAR' },
  // reuniones (4 actividades vs 3 en etapa reunion → gana el 4)
  { id: 'a7', tipo: 'reunion', canal: 'presencial', operador_id: 'op1', lista_id: 'l1', fecha: '2026-07-16T14:00:00' },
  { id: 'a8', tipo: 'reunion', operador_id: 'op2', lista_id: 'l1', fecha: '2026-07-08T14:00:00' },
  { id: 'a9', tipo: 'reunion', operador_id: 'op4', lista_id: 'l2', fecha: '2026-07-01T14:00:00' },
  { id: 'a10', tipo: 'reunion', operador_id: 'op7', fecha: '2026-06-24T10:00:00' }, // semana 06-22, fuera de una serie de 4 semanas
  // whatsapp: op1 dos veces (único) + op3 + una SIN operador → 2 operadores únicos
  { id: 'a11', tipo: 'mensaje', canal: 'whatsapp', operador_id: 'op1', fecha: '2026-07-20T09:00:00' },
  { id: 'a12', tipo: 'mensaje', canal: 'whatsapp', operador_id: 'op1', fecha: '2026-07-21T09:00:00' },
  { id: 'a13', tipo: 'mensaje', canal: 'whatsapp', operador_id: 'op3', fecha: '2026-07-19T18:00:00' }, // domingo → semana 07-13
  { id: 'a14', tipo: 'mensaje', canal: 'whatsapp', fecha: '2026-07-18T09:00:00' }, // sin operador_id
  // linkedin_* SIN canal → canal 'linkedin'
  { id: 'a15', tipo: 'linkedin_contactado', operador_id: 'op5', fecha: '2026-07-20T10:00:00' },
  { id: 'a16', tipo: 'linkedin_respondio', operador_id: 'op5', fecha: '2026-07-15T10:00:00' },
  { id: 'a17', tipo: 'linkedin_acepto', operador_id: 'op8', fecha: '2026-07-06T10:00:00' },
  // emails
  { id: 'a18', tipo: 'email', canal: 'email', operador_id: 'op2', fecha: '2026-07-21T08:00:00' },
  { id: 'a19', tipo: 'email', canal: 'email', operador_id: 'op9', fecha: '2026-05-20T08:00:00' }, // vieja, fuera de cualquier serie corta
  // nota sin canal → bucket 'otro'
  { id: 'a20', tipo: 'nota', operador_id: 'op1', fecha: '2026-07-22T08:00:00' },
  // llamada de Caro SIN fecha (campo faltante) y con `usuario` en vez de usuario_id
  { id: 'a21', tipo: 'llamada', usuario: 'caro', resultado: 'NO ATIENDE' },
];

const LISTAS = [
  { id: 'l1', nombre: 'Kamak-Shell', canal: 'email', costo_mensual: 50000 },
  { id: 'l2', nombre: 'LinkedIn frío', canal: 'linkedin', costoMensual: 30000 }, // camelCase tolerado
  { id: 'l3', nombre: 'WhatsApp piloto', canal: 'whatsapp' }, // sin costo → 0
];

const MIEMBROS = [
  // l1: 4 enviados (m1 estado, m2 estado respondio, m3 enviado_at, m5 enviado_at) / 2 respondieron (m2, m5)
  { id: 'm1', lista_id: 'l1', estado: 'enviado' },
  { id: 'm2', lista_id: 'l1', estado: 'respondio' },
  { id: 'm3', lista_id: 'l1', estado: 'pendiente', enviado_at: '2026-07-10T09:00:00' },
  { id: 'm4', lista_id: 'l1', estado: 'pendiente' },
  { id: 'm5', lista_id: 'l1', enviado_at: '2026-07-09T09:00:00', respondido_at: '2026-07-12T09:00:00' },
  // l2: 3 enviados / 2 respondieron
  { id: 'm6', lista_id: 'l2', estado: 'enviado' },
  { id: 'm7', lista_id: 'l2', estado: 'respondio' },
  { id: 'm8', lista_id: 'l2', estado: 'respondio', respondido_at: '2026-07-11T09:00:00' },
  // l3: nadie enviado (división por cero) — m10 con listaId camelCase
  { id: 'm9', lista_id: 'l3', estado: 'pendiente' },
  { id: 'm10', listaId: 'l3', estado: 'pendiente' },
];

const OBRAS_PROMOVIDAS = [
  { id: 'o1', venta: { etapa: 'ganado' } },
  { id: 'o2', venta: { etapa: 'cotizado' } },
];

// ─── kpisGenerales ───────────────────────────────────────────────────────────
describe('kpisGenerales', () => {
  const kpis = kpisGenerales({ conteoPorEtapa: CONTEO, actividades: ACTIVIDADES, estacionesStats: ESTACIONES_STATS, ahora: AHORA });

  it('contactados = suma de etapas != sin_contactar (12+6+4+3+2+3 = 30)', () => {
    expect(kpis.contactados).toBe(30);
  });
  it('tasaRespuesta = (6+4+3+2)/30 = 50.0%', () => {
    expect(kpis.tasaRespuesta).toBe(50);
  });
  it('reuniones = max(4 actividades reunion, 3 en etapa) = 4', () => {
    expect(kpis.reuniones).toBe(4);
  });
  it('reuniones toma la etapa cuando supera a las actividades', () => {
    const k = kpisGenerales({ conteoPorEtapa: { reunion: 5 }, actividades: [{ tipo: 'reunion', fecha: '2026-07-01T10:00:00' }], ahora: AHORA });
    expect(k.reuniones).toBe(5);
  });
  it('leadsCalientes desde estacionesStats.porEstado', () => {
    expect(kpis.leadsCalientes).toBe(5);
  });
  it('promovidos desde el conteo', () => {
    expect(kpis.promovidos).toBe(2);
  });
  it('llamadasHoy = 3 (a1, a2, a6; a21 sin fecha no cuenta)', () => {
    expect(kpis.llamadasHoy).toBe(3);
  });
  it('llamadasSemana = 5 (a1-a4 + a6; a5 hace 8 días queda afuera)', () => {
    expect(kpis.llamadasSemana).toBe(5);
  });
  it('todo vacío → ceros y tasa 0 (sin división por cero)', () => {
    expect(kpisGenerales({ ahora: AHORA })).toEqual({
      contactados: 0, tasaRespuesta: 0, reuniones: 0, leadsCalientes: 0, promovidos: 0, llamadasHoy: 0, llamadasSemana: 0,
    });
  });
  it('sin argumentos no explota', () => {
    expect(kpisGenerales().contactados).toBe(0);
  });
});

// ─── comparativaListas ───────────────────────────────────────────────────────
describe('comparativaListas', () => {
  const comp = comparativaListas({ listas: LISTAS, miembros: MIEMBROS, actividades: ACTIVIDADES });

  it('ordena por tasaRespuesta desc: l2 (66.7) > l1 (50.0) > l3 (0)', () => {
    expect(comp.map((c) => c.listaId)).toEqual(['l2', 'l1', 'l3']);
  });
  it('l1: 4 enviados, 2 respondieron, 50.0%, 2 reuniones, costo 50000', () => {
    const l1 = comp.find((c) => c.listaId === 'l1');
    expect(l1).toEqual({ listaId: 'l1', nombre: 'Kamak-Shell', canal: 'email', enviados: 4, respondieron: 2, tasaRespuesta: 50, reuniones: 2, costoMensual: 50000 });
  });
  it('l2: 3 enviados, 2 respondieron, 66.7% (redondeo a 1 decimal), 1 reunión, costoMensual camelCase', () => {
    const l2 = comp.find((c) => c.listaId === 'l2');
    expect(l2).toEqual({ listaId: 'l2', nombre: 'LinkedIn frío', canal: 'linkedin', enviados: 3, respondieron: 2, tasaRespuesta: 66.7, reuniones: 1, costoMensual: 30000 });
  });
  it('l3: 0 enviados → tasa 0 sin explotar; miembro con listaId camelCase igual pertenece', () => {
    const l3 = comp.find((c) => c.listaId === 'l3');
    expect(l3).toEqual({ listaId: 'l3', nombre: 'WhatsApp piloto', canal: 'whatsapp', enviados: 0, respondieron: 0, tasaRespuesta: 0, reuniones: 0, costoMensual: 0 });
  });
  it('sin datos → []', () => {
    expect(comparativaListas({})).toEqual([]);
    expect(comparativaListas()).toEqual([]);
  });
});

// ─── embudoConcrecion ────────────────────────────────────────────────────────
describe('embudoConcrecion', () => {
  const embudo = embudoConcrecion({ conteoPorEtapa: CONTEO, actividades: ACTIVIDADES, obrasPromovidas: OBRAS_PROMOVIDAS });

  it('devuelve los 6 escalones en orden', () => {
    expect(embudo.map((e) => e.key)).toEqual(['contacto', 'respondio', 'whatsapp', 'reunion', 'presupuesto', 'obraGanada']);
  });
  it('valores: contacto 27 (sin sin_contactar ni descartado), respondio 15, whatsapp 2 operadores únicos, reunion 5 (reunion+promovido), presupuesto 2, obraGanada 1', () => {
    expect(embudo.map((e) => e.valor)).toEqual([27, 15, 2, 5, 2, 1]);
  });
  it('conversiones: null, 15/27=55.6, 2/15=13.3, 5/2=250, 2/5=40, 1/2=50', () => {
    expect(embudo.map((e) => e.conversionDesdeAnterior)).toEqual([null, 55.6, 13.3, 250, 40, 50]);
  });
  it('cada escalón tiene label', () => {
    for (const e of embudo) expect(typeof e.label).toBe('string');
  });
  it('obra sin venta pero con estado activa cuenta como ganada', () => {
    const e = embudoConcrecion({ obrasPromovidas: [{ estado: 'activa' }] });
    expect(e.find((x) => x.key === 'obraGanada').valor).toBe(1);
  });
  it('obra confirmada sin arrastrar la card (venta.etapa prospecto pero estado activa) cuenta como ganada', () => {
    const e = embudoConcrecion({ obrasPromovidas: [{ venta: { etapa: 'prospecto' }, estado: 'activa' }] });
    expect(e.find((x) => x.key === 'obraGanada').valor).toBe(1);
  });
  it('obra finalizada (venta.etapa prospecto) también cuenta como ganada', () => {
    const e = embudoConcrecion({ obrasPromovidas: [{ venta: { etapa: 'prospecto' }, estado: 'finalizada' }] });
    expect(e.find((x) => x.key === 'obraGanada').valor).toBe(1);
  });
  it('todo vacío → 6 escalones en cero, primera conversión null y el resto 0', () => {
    const e = embudoConcrecion({});
    expect(e.map((x) => x.valor)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e.map((x) => x.conversionDesdeAnterior)).toEqual([null, 0, 0, 0, 0, 0]);
  });
});

// ─── seriePorSemana ──────────────────────────────────────────────────────────
describe('seriePorSemana', () => {
  it('4 semanas: lunes correctos ascendentes terminando en la semana actual', () => {
    const serie = seriePorSemana({ actividades: ACTIVIDADES, semanas: 4, ahora: AHORA });
    expect(serie.map((s) => s.semanaIso)).toEqual(['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20']);
  });
  it('conteos por canal verificados a mano (a10 y a19 fuera de ventana, a21 sin fecha)', () => {
    const serie = seriePorSemana({ actividades: ACTIVIDADES, semanas: 4, ahora: AHORA });
    // 06-29: a9 reunion → otro
    expect(serie[0]).toEqual({ semanaIso: '2026-06-29', porCanal: { llamada: 0, email: 0, linkedin: 0, whatsapp: 0, otro: 1 }, total: 1 });
    // 07-06: a17 linkedin_acepto + a8 reunion sin canal → otro
    expect(serie[1]).toEqual({ semanaIso: '2026-07-06', porCanal: { llamada: 0, email: 0, linkedin: 1, whatsapp: 0, otro: 1 }, total: 2 });
    // 07-13: a4+a5 llamadas, a16 linkedin, a13+a14 whatsapp, a7 reunion canal presencial → otro
    expect(serie[2]).toEqual({ semanaIso: '2026-07-13', porCanal: { llamada: 2, email: 0, linkedin: 1, whatsapp: 2, otro: 1 }, total: 6 });
    // 07-20: a1+a2+a3+a6 llamadas, a18 email, a15 linkedin, a11+a12 whatsapp, a20 nota → otro
    expect(serie[3]).toEqual({ semanaIso: '2026-07-20', porCanal: { llamada: 4, email: 1, linkedin: 1, whatsapp: 2, otro: 1 }, total: 9 });
  });
  it('semanas sin datos se rellenan con ceros', () => {
    const serie = seriePorSemana({ actividades: [], semanas: 2, ahora: AHORA });
    expect(serie).toEqual([
      { semanaIso: '2026-07-13', porCanal: { llamada: 0, email: 0, linkedin: 0, whatsapp: 0, otro: 0 }, total: 0 },
      { semanaIso: '2026-07-20', porCanal: { llamada: 0, email: 0, linkedin: 0, whatsapp: 0, otro: 0 }, total: 0 },
    ]);
  });
  it('default 8 semanas: de 2026-06-01 a 2026-07-20', () => {
    const serie = seriePorSemana({ actividades: [], ahora: AHORA });
    expect(serie).toHaveLength(8);
    expect(serie[0].semanaIso).toBe('2026-06-01');
    expect(serie[7].semanaIso).toBe('2026-07-20');
  });
  it('sin actividades ni nada no explota', () => {
    expect(seriePorSemana({ ahora: AHORA })).toHaveLength(8);
  });
});

// ─── statsLlamadasCaro ───────────────────────────────────────────────────────
describe('statsLlamadasCaro', () => {
  it('hoy 2, semana 4, porResultado con TODAS las llamadas de caro (incluida a21 sin fecha y con `usuario`)', () => {
    expect(statsLlamadasCaro({ actividades: ACTIVIDADES, usuarioId: 'caro', ahora: AHORA })).toEqual({
      hoy: 2,
      semana: 4,
      porResultado: { 'NO ATIENDE': 3, 'PASÓ MAIL': 1, 'LEAD CALIENTE': 1, 'NO INTERESA': 1 },
    });
  });
  it('sin usuarioId cuenta todas las llamadas', () => {
    const s = statsLlamadasCaro({ actividades: ACTIVIDADES, ahora: AHORA });
    expect(s.hoy).toBe(3);
    expect(s.semana).toBe(5);
    expect(s.porResultado['VOLVER A LLAMAR']).toBe(1);
  });
  it('vacío → ceros y porResultado {}', () => {
    expect(statsLlamadasCaro({ actividades: [], usuarioId: 'caro', ahora: AHORA })).toEqual({ hoy: 0, semana: 0, porResultado: {} });
    expect(statsLlamadasCaro({ ahora: AHORA })).toEqual({ hoy: 0, semana: 0, porResultado: {} });
  });
});
