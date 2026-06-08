import { describe, it, expect } from 'vitest';
import {
  matchearExtracto,
  esGastoBancario,
  similitudDescripcion,
  diasEntre,
  montoConSignoMov,
} from './matchExtracto';

// Caja de prueba (Banco Galicia ARS). Los movimientos del sistema guardan monto
// POSITIVO; el signo lo da el tipo (gasto −, ingreso +). Las líneas del extracto
// traen monto CON SIGNO (débito −, crédito +).
const CAJA = 'cj-galicia';

const mov = (over) => ({
  id: 'm-' + Math.random().toString(36).slice(2, 7),
  cajaId: CAJA,
  tipo: 'gasto',
  monto: 0,
  fecha: '2026-05-10',
  descripcion: '',
  ...over,
});

describe('esGastoBancario — keywords del PRE', () => {
  it('detecta comisión, IVA, impuesto, percepción, mantenimiento, etc.', () => {
    expect(esGastoBancario('COMISION MANTENIMIENTO CUENTA')).toBe(true);
    expect(esGastoBancario('IVA 21% sobre comisiones')).toBe(true);
    expect(esGastoBancario('IMPUESTO LEY 25413 DEBITOS')).toBe(true);
    expect(esGastoBancario('Percepción IIBB')).toBe(true);   // acentos
    expect(esGastoBancario('PERCEPCION IVA RG 2408')).toBe(true);
    expect(esGastoBancario('SELLADO de contrato')).toBe(true);
    expect(esGastoBancario('Débito automático servicio')).toBe(true);
    expect(esGastoBancario('SEGURO de caución')).toBe(true);
    expect(esGastoBancario('Ley 25.413 impuesto al cheque')).toBe(true);
  });
  it('NO marca un pago a proveedor común', () => {
    expect(esGastoBancario('TRF Don Luis SRL materiales')).toBe(false);
    expect(esGastoBancario('Pago Leandro construcción seco')).toBe(false);
    expect(esGastoBancario('')).toBe(false);
    expect(esGastoBancario(null)).toBe(false);
  });
});

describe('diasEntre', () => {
  it('cuenta días absolutos entre dos fechas ISO', () => {
    expect(diasEntre('2026-05-10', '2026-05-10')).toBe(0);
    expect(diasEntre('2026-05-10', '2026-05-12')).toBe(2);
    expect(diasEntre('2026-05-12', '2026-05-10')).toBe(2); // simétrico
  });
  it('null si falta alguna fecha', () => {
    expect(diasEntre(null, '2026-05-10')).toBe(null);
    expect(diasEntre('2026-05-10', '')).toBe(null);
  });
});

describe('montoConSignoMov — signo según tipo', () => {
  it('gasto es negativo, ingreso positivo', () => {
    expect(montoConSignoMov(mov({ tipo: 'gasto', monto: 245000 }), CAJA)).toBe(-245000);
    expect(montoConSignoMov(mov({ tipo: 'ingreso', monto: 1200000 }), CAJA)).toBe(1200000);
  });
});

describe('similitudDescripcion', () => {
  it('alta cuando comparten tokens (sin acentos, orden libre)', () => {
    expect(similitudDescripcion('Don Luis materiales', 'Materiales Don Luis')).toBeGreaterThan(0.5);
  });
  it('cero cuando no comparten nada', () => {
    expect(similitudDescripcion('comision banco', 'pago pintura')).toBe(0);
  });
  it('cero si alguna vacía', () => {
    expect(similitudDescripcion('', 'algo')).toBe(0);
  });
});

describe('matchearExtracto — coincide', () => {
  it('1 candidato, mismo monto, misma fecha, descripción parecida → coincide', () => {
    const movs = [mov({ id: 'mDon', tipo: 'gasto', monto: 245000, fecha: '2026-05-02', descripcion: 'Mat. eléctrica Don Luis SRL' })];
    const lineas = [{ fecha: '2026-05-02', descripcion: 'TRF Don Luis SRL', monto: -245000 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('coincide');
    expect(r.lineas[0].movimientoId).toBe('mDon');
    expect(r.resumen.coincide).toBe(1);
    expect(r.huerfanos).toHaveLength(0);
  });

  it('coincide con fecha a ±1 día aunque descripción difiera (único candidato, fecha=0 prima)', () => {
    const movs = [mov({ id: 'mX', tipo: 'gasto', monto: 500000, fecha: '2026-05-10', descripcion: 'Pago Leandro const seco' })];
    const lineas = [{ fecha: '2026-05-10', descripcion: 'ECHEQ 9988', monto: -500000 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    // mismo día (dias===0) y único → coincide aunque la descripción no se parezca
    expect(r.lineas[0].estado).toBe('coincide');
    expect(r.lineas[0].movimientoId).toBe('mX');
  });

  it('un INGRESO del sistema matchea un CRÉDITO del extracto', () => {
    const movs = [mov({ id: 'mIn', tipo: 'ingreso', monto: 1200000, fecha: '2026-05-08', descripcion: 'Cobro Familia Perez cuota 4' })];
    const lineas = [{ fecha: '2026-05-08', descripcion: 'TRF DESDE Familia Perez', monto: 1200000 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('coincide');
    expect(r.lineas[0].movimientoId).toBe('mIn');
  });
});

describe('matchearExtracto — parecido (requiere confirmación)', () => {
  it('mismo monto pero fecha lejana (2 días) y descripción dispar → parecido', () => {
    const movs = [mov({ id: 'mLej', tipo: 'gasto', monto: 380000, fecha: '2026-05-02', descripcion: 'Pago Easy albañilería Pilar' })];
    const lineas = [{ fecha: '2026-05-04', descripcion: 'DEBITO VARIOS 0099', monto: -380000 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('parecido');
    expect(r.lineas[0].movimientoId).toBe(null);        // no se auto-asigna
    expect(r.lineas[0].candidatos).toHaveLength(1);
    expect(r.lineas[0].candidatos[0].movimientoId).toBe('mLej');
  });

  it('VARIOS candidatos con el mismo monto → parecido (hay que elegir)', () => {
    const movs = [
      mov({ id: 'mA', tipo: 'gasto', monto: 245000, fecha: '2026-05-02', descripcion: 'Don Luis materiales' }),
      mov({ id: 'mB', tipo: 'gasto', monto: 245000, fecha: '2026-05-03', descripcion: 'Don Luis materiales' }),
    ];
    const lineas = [{ fecha: '2026-05-02', descripcion: 'TRF Don Luis', monto: -245000 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('parecido');
    expect(r.lineas[0].candidatos.length).toBeGreaterThanOrEqual(2);
  });
});

describe('matchearExtracto — no_coincide', () => {
  it('sin ningún movimiento del mismo monto en la ventana → no_coincide', () => {
    const movs = [mov({ id: 'm1', tipo: 'gasto', monto: 999999, fecha: '2026-05-05', descripcion: 'otra cosa' })];
    const lineas = [{ fecha: '2026-05-05', descripcion: 'COMISION MANTENIMIENTO', monto: -12500 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('no_coincide');
    expect(r.lineas[0].movimientoId).toBe(null);
    expect(r.lineas[0].candidatos).toHaveLength(0);
  });

  it('monto igual pero FUERA de la ventana (>2 días) → no_coincide', () => {
    const movs = [mov({ id: 'm1', tipo: 'gasto', monto: 50000, fecha: '2026-05-01', descripcion: 'algo' })];
    const lineas = [{ fecha: '2026-05-10', descripcion: 'algo', monto: -50000 }];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('no_coincide');
  });

  it('signo distinto NO matchea (un débito no concilia un ingreso del mismo valor)', () => {
    const movs = [mov({ id: 'mIn', tipo: 'ingreso', monto: 50000, fecha: '2026-05-10', descripcion: 'cobro' })];
    const lineas = [{ fecha: '2026-05-10', descripcion: 'debito', monto: -50000 }]; // débito
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    expect(r.lineas[0].estado).toBe('no_coincide');
  });
});

describe('matchearExtracto — huérfanos', () => {
  it('un movimiento del período que ninguna línea matcheó es huérfano', () => {
    const movs = [
      mov({ id: 'mMatch', tipo: 'gasto', monto: 245000, fecha: '2026-05-02', descripcion: 'Don Luis materiales' }),
      mov({ id: 'mHuerf', tipo: 'gasto', monto: 180000, fecha: '2026-05-11', descripcion: 'Pago Ariel pintura Tigre' }),
    ];
    const lineas = [{ fecha: '2026-05-02', descripcion: 'TRF Don Luis materiales', monto: -245000 }];
    const r = matchearExtracto(lineas, movs, {
      cajaId: CAJA, periodoDesde: '2026-05-01', periodoHasta: '2026-05-15',
    });
    expect(r.lineas[0].estado).toBe('coincide');
    expect(r.huerfanos.map(m => m.id)).toEqual(['mHuerf']);
    expect(r.resumen.huerfanos).toBe(1);
  });

  it('un movimiento FUERA del período NO es huérfano (no debería estar en el extracto)', () => {
    const movs = [mov({ id: 'mFuera', tipo: 'gasto', monto: 70000, fecha: '2026-04-20', descripcion: 'gasto de marzo' })];
    const r = matchearExtracto([], movs, {
      cajaId: CAJA, periodoDesde: '2026-05-01', periodoHasta: '2026-05-15',
    });
    expect(r.huerfanos).toHaveLength(0);
  });

  it('un movimiento ya conciliado no entra al pool ni cuenta como huérfano', () => {
    const movs = [mov({ id: 'mYa', tipo: 'gasto', monto: 90000, fecha: '2026-05-05', descripcion: 'ya conciliado', conciliado: true })];
    const r = matchearExtracto([], movs, {
      cajaId: CAJA, periodoDesde: '2026-05-01', periodoHasta: '2026-05-15',
    });
    expect(r.huerfanos).toHaveLength(0);
  });
});

describe('matchearExtracto — no asigna el mismo movimiento a dos líneas', () => {
  it('dos líneas iguales con un solo movimiento: una coincide, la otra no_coincide', () => {
    const movs = [mov({ id: 'mUno', tipo: 'gasto', monto: 100000, fecha: '2026-05-06', descripcion: 'pago x' })];
    const lineas = [
      { fecha: '2026-05-06', descripcion: 'pago x', monto: -100000 },
      { fecha: '2026-05-06', descripcion: 'pago x', monto: -100000 },
    ];
    const r = matchearExtracto(lineas, movs, { cajaId: CAJA });
    const estados = r.lineas.map(l => l.estado).sort();
    // El movimiento se reserva para la que coincide; la otra se queda sin candidato.
    expect(estados).toContain('coincide');
    expect(estados).toContain('no_coincide');
    const conMov = r.lineas.filter(l => l.movimientoId === 'mUno');
    expect(conMov).toHaveLength(1);
  });
});
