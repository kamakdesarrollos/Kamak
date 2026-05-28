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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const cobradoUSD = movs
      .filter(m => m.obraId === obraId && m.tipo === 'ingreso')
      .reduce((s, m) => {
        if (m.montoDolar) return s + Math.round(m.montoDolar);
        const caja = cajas.find(c => c.id === m.cajaId);
        const esUSD = caja?.moneda === 'USD';
        return s + (esUSD ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (dolarVenta || 1)));
      }, 0);

    return res.status(200).json({
      obra,
      detalle,
      // Devolvemos solo el cliente (nombre) — no toda la lista
      clienteNombre: cliente?.nombre || obra.cliente || '',
      dolarVenta,
      cobradoUSD,
    });
  } catch (e) {
    console.error('[portal/data] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
