// Emisión electrónica AFIP (WSFEv1 · FECAESolicitar) — ANDAMIAJE.
//
// El mapeo comprobante → estructura WSFE está completo y testeado en
// src/lib/wsfe.js. El front arma el payload con feCaeSolicitarPayload() y lo
// POSTea acá. Lo que falta cablear (necesita el CERTIFICADO de AFIP):
//
//   1. WSAA — firmar el Login Ticket Request (CMS/PKCS#7) con AFIP_CERT + AFIP_KEY
//      y obtener el Ticket de Acceso (token + sign, dura ~12hs; conviene cachearlo
//      en shared_data). Requiere una librería de firma CMS (p.ej. node-forge) o el
//      SDK de AFIP — Node no tiene CMS de alto nivel built-in.
//   2. WSFE — con el TA: FECompUltimoAutorizado (último número del PtoVta+tipo)
//      para asignar CbteDesde, y FECAESolicitar para pedir el CAE. Endpoints según
//      AFIP_ENV: homologación (wswhomo.afip.gov.ar) o producción.
//
// Hasta configurar el certificado, responde 501 con instrucciones. Ver
// docs/WSFE-SETUP.md. Probar SIEMPRE primero en homologación.

const AFIP_CUIT = process.env.AFIP_CUIT;
const AFIP_CERT = process.env.AFIP_CERT;   // certificado .crt (PEM, puede venir base64)
const AFIP_KEY  = process.env.AFIP_KEY;    // clave privada .key (PEM)
const AFIP_ENV  = process.env.AFIP_ENV || 'homologacion';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Diagnóstico: ¿está configurado el certificado?
    return res.status(200).json({
      ok: true,
      configurado: !!(AFIP_CUIT && AFIP_CERT && AFIP_KEY),
      env: AFIP_ENV,
      faltan: [
        !AFIP_CUIT && 'AFIP_CUIT',
        !AFIP_CERT && 'AFIP_CERT',
        !AFIP_KEY && 'AFIP_KEY',
      ].filter(Boolean),
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!AFIP_CUIT || !AFIP_CERT || !AFIP_KEY) {
    return res.status(501).json({
      error: 'AFIP no configurado',
      detalle: 'Faltan variables de entorno en Vercel (AFIP_CUIT / AFIP_CERT / AFIP_KEY). Generá el certificado en AFIP y cargalas. Ver docs/WSFE-SETUP.md.',
      faltan: [!AFIP_CUIT && 'AFIP_CUIT', !AFIP_CERT && 'AFIP_CERT', !AFIP_KEY && 'AFIP_KEY'].filter(Boolean),
    });
  }

  // El certificado está, pero falta cablear la firma WSAA (CMS) y las llamadas
  // SOAP a WSFE. No emitimos algo a medias: devolvemos un estado claro.
  return res.status(501).json({
    error: 'WSFE pendiente de implementación',
    detalle: 'Certificado presente. Falta implementar la firma WSAA (CMS/PKCS#7) + las llamadas SOAP a WSFE (FECompUltimoAutorizado + FECAESolicitar). El mapeo del comprobante ya está listo en src/lib/wsfe.js. Ver docs/WSFE-SETUP.md.',
    env: AFIP_ENV,
  });
}
