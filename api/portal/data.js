// Endpoint del portal del cliente.
// Recibe un token y devuelve los datos de la obra correspondiente.
// Usa la SERVICE_KEY de Supabase del lado backend para bypasear RLS, asi
// el cliente sin sesion auth puede ver los datos. La seguridad esta dada
// por el token (que solo conoce el cliente con el link valido) — no se
// devuelve ningun dato sin token valido y vigente.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbH = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}

function nombreMatch(a, b) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const A = norm(a), B = norm(b);
  return !!A && !!B && A === B;
}

// ── Sanitización para el portal del cliente ──────────────────────────────────
// El portal del cliente NO debe ver NINGÚN costo ni margen. Calculamos la venta
// acá (server) y mandamos un detalle con whitelist estricta. Antes los rubros/
// tareas viajaban crudos (costoMat, costoSub, margenLinea, margenMat, margenMO) y
// el navegador del cliente los recibía en el JSON aunque no se "mostraran".
function tareaVentaUnit(t, rubro) {
  // Réplica EXACTA de tareaVentaUnit en src/pages/obra/helpers.js: respeta
  // materialesACargoComprador y margen por línea o por rubro (mat / mano de obra).
  const mat = rubro.materialesACargoComprador ? 0 : (t.costoMat || 0);
  const sub = t.costoSub || 0;
  if (t.margenLinea != null) return (mat + sub) * (1 + t.margenLinea / 100);
  return mat * (1 + (rubro.margenMat || 0) / 100) + sub * (1 + (rubro.margenMO || 0) / 100);
}
function ventaRubro(rubro) {
  return (rubro.tareas || [])
    .filter(t => t.tipo !== 'seccion')
    .reduce((s, t) => s + tareaVentaUnit(t, rubro) * (t.cantidad || 0), 0);
}
// Detalle SANITIZADO: whitelist. NO incluye costoMat/costoSub/costoGral/margen*
// ni cantidades — solo venta ya calculada, avance, plan de pagos, docs y fotos.
// Seguros para el portal del cliente: transparencia de seguridad en obra SIN
// exponer quiénes son los contratistas/personal (dato comercial sensible) ni
// DNI/CUIT. Solo: por cada contrato, cuántos asegurados hay + estado de la
// póliza (cargada o no) + vencimiento. Sin nombres, sin números de póliza.
function segurosPortal(detalle) {
  const contratos = detalle.contratos || [];
  const segMap = detalle.segurosPorContrato || {};
  return contratos.map((c, i) => {
    const seg = segMap[c.id] || {};
    const asegurados = 1 + ((c.colaboradores || []).length); // líder + colaboradores
    return {
      id: c.id,
      label: `Contratista ${i + 1}`,        // anónimo: NO se expone el nombre real
      asegurados,
      polizaCargada: !!seg.polizaUrl,
      polizaVence: seg.polizaVence || null,
    };
  });
}
// PÓLIZAS para el portal del cliente (Anexo V / transparencia de cobertura):
// el cliente PUEDE ver el documento de la póliza de cada contratista para
// descargarlo/abrirlo. Whitelist estricta: SOLO nombre del contratista + link
// de la póliza + vencimiento. NO se exponen montos, costos, márgenes, planes de
// pago, colaboradores, DNI ni CUIT. Solo se devuelven los contratos que TIENEN
// una póliza cargada (no se filtra la nómina completa de contratistas).
function polizasPortal(detalle) {
  const contratos = detalle.contratos || [];
  const segMap = detalle.segurosPorContrato || {};
  return contratos
    .map(c => {
      const seg = segMap[c.id] || {};
      if (!seg.polizaUrl) return null;       // sin póliza subida → no se publica
      return {
        id: c.id,
        contratista: c.proveedor || 'Contratista',  // nombre, sin CUIT/domicilio
        polizaUrl: seg.polizaUrl,
        polizaVence: seg.polizaVence || null,
      };
    })
    .filter(Boolean);
}
function sanitizeDetalle(detalle) {
  if (!detalle) return null;
  const rubros = (detalle.rubros || []).map(r => ({
    id: r.id,
    nombre: r.nombre,
    proveedor: r.proveedor || null,
    ventaPortal: ventaRubro(r),                 // venta del rubro YA calculada (ARS)
    tareas: (r.tareas || []).map(t => ({
      id: t.id,
      tipo: t.tipo || null,
      nombre: t.nombre || t.descripcion || '',
      nota: t.nota || '',          // nota de alcance (sector / qué no incluye) — visible al cliente
      avance: t.avance || 0,
    })),
  }));
  const adicionales = (detalle.adicionales || []).map(a => ({
    id: a.id,
    descripcion: a.descripcion,
    fecha: a.fecha || null,
    estado: a.estado || null,
    aplicaACliente: a.aplicaACliente !== false,
    // valor que se le COBRA al cliente, ya resuelto (sin exponer el costo interno)
    valorVentaTotal: (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0),
  }));
  const fin = detalle.financiacion || {};
  return {
    rubros,
    adicionales,
    ventaBaseARS: rubros.reduce((s, r) => s + r.ventaPortal, 0),
    precioVentaUSD: detalle.precioVentaUSD ?? null,   // precio de venta fijo en USD (NO es costo)
    cuotas: detalle.cuotas || [],
    documentos: (detalle.documentos || []).map(d => ({ id: d.id, nombre: d.nombre, tipo: d.tipo, fecha: d.fecha, url: d.url, carpeta: d.carpeta || '' })),
    fotos: (detalle.fotos || []).map(f => ({ id: f.id, label: f.label, rubro: f.rubro, fecha: f.fecha, url: f.url, carpeta: f.carpeta || '' })),
    // Seguros: solo estado de cobertura por contratista (anónimo), sin nombres/DNI/CUIT.
    seguros: segurosPortal(detalle),
    // Pólizas (Anexo V): documento descargable por contratista. Nombre + link +
    // vencimiento, SIN montos/costos/colaboradores/DNI/CUIT. Solo las cargadas.
    polizas: polizasPortal(detalle),
    financiacion: { interes: fin.interes ?? 0, notaPortal: fin.notaPortal || '' },
    // Contrato para firma en el portal: whitelist estricta. NO incluye
    // hashDocumento, ip, dni ni nada de costos/margen.
    contrato: detalle.contrato ? {
      estado: detalle.contrato.estado,
      version: detalle.contrato.version,
      htmlRenderizado: detalle.contrato.htmlRenderizado,   // ya sanitizado al generar
      fechaEnviado: detalle.contrato.fechaEnviado || null,
      fechaFirmado: detalle.contrato.fechaFirmado || null,
      firma: detalle.contrato.firma ? { nombre: detalle.contrato.firma.nombre, fecha: detalle.contrato.firma.fecha } : null,
    } : null,
  };
}

export default async function handler(req, res) {
  // PORTAL-DATA-003: CORS restringido a los dominios kamak (el token sigue siendo
  // el gate real, pero esto evita que cualquier sitio lea la respuesta desde un
  // browser). Si el portal se sirve desde otro dominio, agregarlo al regex.
  const origin = req.headers.origin || '';
  const corsOk = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', corsOk ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  try {
    // 1) Validar token
    const tokens = await loadSharedData('portal_tokens');
    const entry = tokens?.[token];
    if (!entry) return res.status(404).json({ error: 'invalid' });
    if (entry.expires && new Date(entry.expires) < new Date()) {
      return res.status(410).json({ error: 'expired' });
    }

    const obraId = entry.obraId;

    // 2) Cargar data en paralelo
    const [obrasData, clientesData, dolarData, movData] = await Promise.all([
      loadSharedData('obras'),
      loadSharedData('clientes'),
      loadSharedData('dolar'),
      loadSharedData('movimientos'),
    ]);

    // 3) Filtrar al cliente solo a su obra (no exponer todas las obras)
    const obra = obrasData?.obras?.find(o => o.id === obraId) || null;
    const detalle = obrasData?.detalles?.[obraId] || null;

    if (!obra) return res.status(404).json({ error: 'obra_not_found' });

    // Resolver cliente: por clienteId si existe, sino por nombre.
    const clientes = Array.isArray(clientesData) ? clientesData : [];
    const cliente = (obra.clienteId && clientes.find(c => c.id === obra.clienteId))
      || clientes.find(c => nombreMatch(c.nombre, obra.cliente))
      || null;

    // Dolar
    const dolarVenta = dolarData?.manual
      ? (dolarData.manualVal || 1070)
      : (dolarData?.venta || 1070);

    // Cobrado del cliente DERIVADO de los movimientos de ingreso de la obra
    // (libro único). Lo calculamos acá (server) porque el portal no tiene
    // acceso a los movimientos. El portal lo reparte sobre las cuotas.
    const movs  = movData?.movimientos || [];
    const cajas = movData?.cajas || [];
    // Lista de cobros en USD (fecha + monto), ordenada. NO exponemos caja ni
    // concepto interno: el cliente solo necesita la fecha para "Pagada el". El
    // portal reparte esto sobre las cuotas (mismo waterfall que el admin).
    const ingresos = movs
      .filter(m => m.obraId === obraId && m.tipo === 'ingreso')
      .map(m => {
        let monto;
        if (m.montoDolar) monto = Math.round(m.montoDolar);
        else {
          const caja = cajas.find(c => c.id === m.cajaId);
          monto = caja?.moneda === 'USD' ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (dolarVenta || 1));
        }
        return { fecha: m.fecha, monto };
      })
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    const cobradoUSD = ingresos.reduce((s, i) => s + i.monto, 0);

    // PORTAL-DATA-004: el portal del cliente NO debe ver NINGÚN costo ni margen.
    // De la obra sacamos gastado y margen. Los costos por tarea (costoMat/costoSub/
    // margen*) vivían en los rubros del detalle y viajaban al navegador del cliente:
    // ahora el detalle se SANITIZA con whitelist (venta ya calculada en server, sin
    // contratos ni movimientos internos). Ver sanitizeDetalle().
    // Whitelist ESTRICTA del encabezado de la obra: SOLO los campos que el portal
    // del cliente realmente muestra (verificado contra PortalCliente.jsx). Todo lo
    // demás se queda en el server y NUNCA llega al JSON del navegador del cliente:
    // en especial `venta` (embudo Comercial: etapa, motivoPerdida, changelog),
    // `gastado`, `margen`, `prioridad`, `destacada`, `web` y cualquier campo futuro.
    const obraPublica = {
      id: obra.id,
      nombre: obra.nombre,
      cliente: obra.cliente,
      tipo: obra.tipo,
      estado: obra.estado,
      moneda: obra.moneda,
      direccion: obra.direccion,
      avance: obra.avance,
      fechaInicio: obra.fechaInicio,
      fechaFinEstim: obra.fechaFinEstim,
      presupuesto: obra.presupuesto,   // se muestra como "Presupuesto total" (precio de venta)
      notas: obra.notas,               // se muestran al cliente en el portal
    };
    const detallePublico = sanitizeDetalle(detalle);

    return res.status(200).json({
      obra: obraPublica,
      detalle: detallePublico,
      // Devolvemos solo el cliente (nombre) — no toda la lista
      clienteNombre: cliente?.nombre || obra.cliente || '',
      dolarVenta,
      cobradoUSD,
      ingresos,
    });
  } catch (e) {
    console.error('[portal/data] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
