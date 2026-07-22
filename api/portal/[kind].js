// Único Vercel function para los endpoints del portal del cliente. Despacha por
// el segmento de ruta: /api/portal/data → dataHandler · /api/portal/validate-token
// → validateTokenHandler · /api/portal/solicitar-otp → solicitarOtpHandler ·
// /api/portal/firmar → firmarHandler. Se combinan en 1 function para no superar
// el límite de funciones del plan Hobby (mismo patrón que api/public/[kind].js).
// Cada handler conserva su propio CORS/gate — acá solo se parsea `kind` y se delega.
import dataHandler from '../../lib/portal/data.js';
import validateTokenHandler from '../../lib/portal/validate-token.js';
import solicitarOtpHandler from '../../lib/portal/solicitar-otp.js';
import firmarHandler from '../../lib/portal/firmar.js';

export default async function handler(req, res) {
  const kind = req.query.kind;
  if (kind === 'data') return dataHandler(req, res);
  if (kind === 'validate-token') return validateTokenHandler(req, res);
  if (kind === 'solicitar-otp') return solicitarOtpHandler(req, res);
  if (kind === 'firmar') return firmarHandler(req, res);
  res.setHeader('Access-Control-Allow-Origin', 'https://kamak.com.ar');
  return res.status(404).json({ error: 'not_found' });
}
