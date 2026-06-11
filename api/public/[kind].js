// Único Vercel function para los endpoints públicos de la web. Despacha por el
// segmento de ruta: /api/public/obras → obrasHandler · /api/public/leads → leadsHandler.
// Se combinan en 1 function para no superar el límite de funciones del plan.
import { obrasHandler, leadsHandler } from '../../lib/web/handlers.js';

export default async function handler(req, res) {
  const kind = req.query.kind;
  if (kind === 'obras') return obrasHandler(req, res);
  if (kind === 'leads') return leadsHandler(req, res);
  res.setHeader('Access-Control-Allow-Origin', 'https://kamak.com.ar');
  return res.status(404).json({ error: 'not_found' });
}
