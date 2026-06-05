import { useEffect, useRef } from 'react';
import { useObras } from '../store/ObrasContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { cobradoObraUSD } from '../pages/obra/helpers';
import { necesitaGanarPorPago } from '../lib/ventaEtapa';

// Reconciliador global del embudo: si una obra recibió un pago pero su etapa de
// venta no es ganado/perdido, la mueve a 'ganado'. Centraliza la regla que antes
// solo corría dentro de ObraPresupuesto (PIEZA 2). No renderiza nada.
export default function VentaSync() {
  const { obras, setVentaEtapa } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const enProceso = useRef(new Set()); // evita re-disparos mientras propaga el state

  useEffect(() => {
    const tc = dolarVenta || 1070;
    for (const o of obras) {
      if (enProceso.current.has(o.id)) continue;
      const cobrado = cobradoObraUSD(movimientos, cajas, o.id, tc);
      if (necesitaGanarPorPago(o, cobrado)) {
        enProceso.current.add(o.id);
        setVentaEtapa(o.id, 'ganado', { usuario: 'sistema' });
      }
    }
  }, [obras, movimientos, cajas, dolarVenta, setVentaEtapa]);

  return null;
}
