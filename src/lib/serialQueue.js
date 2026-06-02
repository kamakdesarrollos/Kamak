// createSerialQueue — encadena tareas async para que se ejecuten en orden FIFO
// (la siguiente arranca recién cuando la anterior terminó), aunque una previa
// sea más lenta. Se usa para serializar las escrituras del catálogo
// (append/patch/remove por ítem): sin esto, crear una copia y borrarla rápido
// podía llegar desordenado al servidor y la copia "reaparecía".
export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    // Corre `task` cuando `tail` se asienta (haya resuelto o fallado la anterior).
    const run = tail.then(task, task);
    // La cola sigue pase lo que pase con esta tarea (no se corta por un error).
    tail = run.then(() => {}, () => {});
    return run;
  };
}
