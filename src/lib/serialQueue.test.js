import { describe, it, expect } from 'vitest';
import { createSerialQueue } from './serialQueue';

// Garantiza que las escrituras del catálogo (append/patch/remove) se apliquen
// EN ORDEN aunque se disparen async. Sin esto: crear una copia y borrarla
// rápido podía llegar desordenado al server (borra antes de crear → la copia
// queda) y "reaparece" al recargar.

describe('serialQueue', () => {
  it('ejecuta las tareas en orden FIFO aunque una previa sea más lenta', async () => {
    const q = createSerialQueue();
    const order = [];
    const lenta  = () => new Promise(r => setTimeout(() => { order.push('crear');  r('a'); }, 40));
    const rapida = () => new Promise(r => setTimeout(() => { order.push('borrar'); r('b'); }, 1));
    const p1 = q(lenta);   // "crear" (lento)
    const p2 = q(rapida);  // "borrar" (rápido) — NO debe adelantarse
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(order).toEqual(['crear', 'borrar']); // borrar esperó a crear
    expect(r1).toBe('a');
    expect(r2).toBe('b');
  });

  it('devuelve el resultado de cada tarea al que la encoló', async () => {
    const q = createSerialQueue();
    await expect(q(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('si una tarea falla, la cola sigue con la siguiente', async () => {
    const q = createSerialQueue();
    const order = [];
    await q(() => Promise.reject(new Error('boom'))).catch(() => {});
    await q(() => { order.push('sigue'); return Promise.resolve(); });
    expect(order).toEqual(['sigue']);
  });

  it('mantiene el orden con muchas tareas de latencia variable', async () => {
    const q = createSerialQueue();
    const order = [];
    const tasks = [30, 5, 20, 1, 10].map((ms, i) =>
      q(() => new Promise(r => setTimeout(() => { order.push(i); r(); }, ms)))
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});
