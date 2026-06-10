import { useEffect, useRef } from 'react';
import { useObras } from '../store/ObrasContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { useComercial } from '../store/ComercialContext';
import { cobradoObraUSD } from '../pages/obra/helpers';
import { necesitaGanarPorPago } from '../lib/ventaEtapa';

// Reconciliador global del embudo: si una obra recibió un pago pero su etapa de
// venta no es ganado/perdido, la mueve a 'ganado'. Centraliza la regla que antes
// solo corría dentro de ObraPresupuesto (PIEZA 2). No renderiza nada.
export default function VentaSync() {
  const { obras, setVentaEtapa, dataReady } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { addActividad } = useComercial();
  const enProceso = useRef(new Set()); // evita re-disparos mientras propaga el state

  useEffect(() => {
    // GATE anti race: no barrer 'obras' hasta que las obras REALES estén
    // cargadas de Supabase. Antes de dataReady, 'obras' es el seed/localStorage
    // (obras DEMO) y este barrido llamaría setVentaEtapa -> markUserEdit,
    // dejando al usuario pegado en las obras demo (mismo bug que el bridge).
    if (!dataReady) return;
    const tc = dolarVenta || 1070;
    for (const o of obras) {
      if (enProceso.current.has(o.id)) continue;
      const cobrado = cobradoObraUSD(movimientos, cajas, o.id, tc);
      if (necesitaGanarPorPago(o, cobrado)) {
        enProceso.current.add(o.id);
        setVentaEtapa(o.id, 'ganado', { usuario: 'sistema' });
        // Registra el cambio de etapa en el timeline (auto-ganada por cobro).
        addActividad({ clienteId: o.clienteId || null, obraId: o.id, tipo: 'cambio_etapa', texto: `Ganada automáticamente por cobro — ${o.nombre}`, usuario: 'sistema' });
      }
    }
  }, [dataReady, obras, movimientos, cajas, dolarVenta, setVentaEtapa, addActividad]);

  return null;
}
