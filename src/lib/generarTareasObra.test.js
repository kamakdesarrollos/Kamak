import { describe, it, expect } from 'vitest';
import { generarTareasObra } from './generarTareasObra';

const catalog = {
  rubros: [],
  tiposObra: [],
  tareas: [
    { id: 'apu-cartel', nombre: 'Cartel de obra', tareasEstandar: [
      { id: 'te1', titulo: 'Mandar a hacer el cartel', rol: 'Logística y compras', diasOffset: 2, prioridad: 'alta', checklist: ['medidas', 'arte'] },
    ] },
    { id: 'apu-otro', nombre: 'Otra cosa', tareasEstandar: [] },
  ],
};
const usuarios = [{ id: 'u1', rol: 'Logística y compras' }, { id: 'u2', rol: 'Admin' }];

const detalleCon = (nombres) => ({
  rubros: [{ id: 'r1', nombre: 'Gráfica', tareas: nombres.map((n, i) => ({ id: 'bt' + i, nombre: n, tipo: n === '__sec__' ? 'seccion' : 'tarea' })) }],
  fechaAprobacion: '2026-06-02',
});

describe('generarTareasObra — tareas estándar a nivel APU', () => {
  it('genera la tarea del APU presente en el presupuesto, asignada por rol', () => {
    const { tareasNuevas, apusAplicados } = generarTareasObra({
      obra: { id: 'o1' }, detalle: detalleCon(['Cartel de obra', 'Otra cosa']), catalog, usuarios, generadoPor: 'u2',
    });
    const cartel = tareasNuevas.find(t => t.titulo === 'Mandar a hacer el cartel');
    expect(cartel).toBeTruthy();
    expect(cartel.asignadoA).toEqual(['u1']);        // usuario con rol "Logística y compras"
    expect(cartel.origen).toBe('auto-apu');
    expect(cartel.prioridad).toBe('alta');
    expect(cartel.fechaLimite).toBe('2026-06-04');   // +2 días
    expect(cartel.checklist).toEqual([{ texto: 'medidas' }, { texto: 'arte' }]);
    expect(apusAplicados).toContain('apu-cartel');
  });

  it('NO genera si el APU no está en el presupuesto', () => {
    const { tareasNuevas } = generarTareasObra({ obra: { id: 'o1' }, detalle: detalleCon(['Otra cosa']), catalog, usuarios, generadoPor: 'u2' });
    expect(tareasNuevas.find(t => t.titulo === 'Mandar a hacer el cartel')).toBeFalsy();
  });

  it('es idempotente: no re-genera si el APU ya está en apusAplicados', () => {
    const detalle = { ...detalleCon(['Cartel de obra']), tareasGeneradas: { apusAplicados: ['apu-cartel'] } };
    const { tareasNuevas } = generarTareasObra({ obra: { id: 'o1' }, detalle, catalog, usuarios, generadoPor: 'u2' });
    expect(tareasNuevas.find(t => t.titulo === 'Mandar a hacer el cartel')).toBeFalsy();
  });

  it('un APU repetido en el presupuesto genera la tarea UNA sola vez', () => {
    const { tareasNuevas, apusAplicados } = generarTareasObra({ obra: { id: 'o1' }, detalle: detalleCon(['Cartel de obra', 'Cartel de obra']), catalog, usuarios, generadoPor: 'u2' });
    expect(tareasNuevas.filter(t => t.titulo === 'Mandar a hacer el cartel')).toHaveLength(1);
    expect(apusAplicados).toEqual(['apu-cartel']);
  });

  it('saltea filas de sección (tipo seccion) y APUs sin tareasEstandar', () => {
    const { tareasNuevas } = generarTareasObra({ obra: { id: 'o1' }, detalle: detalleCon(['__sec__', 'Otra cosa']), catalog, usuarios, generadoPor: 'u2' });
    expect(tareasNuevas).toHaveLength(0);
  });
});
