// WSAA — Autenticación con AFIP (obtención del Ticket de Acceso: token + sign).
//
// El flujo de AFIP es:
//   1. Armar el "Login Ticket Request" (TRA): un XML con el servicio pedido y una
//      ventana de validez (ver buildLoginTicketRequest en src/lib/wsfe.js).
//   2. FIRMARLO como CMS/PKCS#7 (SignedData) con el certificado + clave privada.
//      Esto es lo que prueba a AFIP que somos quien decimos ser. Lo hacemos con
//      node-forge (JS puro) → tus datos NO pasan por ningún tercero.
//   3. Enviar el CMS (base64) al WebService de Autenticación (LoginCms).
//   4. AFIP devuelve un Ticket de Acceso (TA) con token + sign, válido ~12hs.
//
// El TA conviene cachearlo (no pedir uno nuevo en cada factura): AFIP RECHAZA un
// segundo pedido mientras hay uno vigente. El cacheo lo maneja el caller
// (api/afip/emitir.js usa shared_data; el script de prueba usa un archivo local).

import forge from 'node-forge';
import { buildLoginTicketRequest } from '../../src/lib/wsfe.js';

const WSAA_URLS = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion:   'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

// Las env vars suelen traer los PEM con saltos de línea escapados (\n literales) o
// incluso todo el PEM en base64. Esto lo normaliza a un PEM real.
export function normalizePem(s) {
  if (!s) return s;
  let v = String(s).trim();
  if (!v.includes('-----BEGIN')) {
    // Vino en base64 sin headers PEM → decodificar.
    try {
      const dec = Buffer.from(v, 'base64').toString('utf8');
      if (dec.includes('-----BEGIN')) v = dec;
    } catch { /* se deja como está */ }
  }
  return v.replace(/\\n/g, '\n').trim();
}

// Firma el TRA como CMS/PKCS#7 SignedData → DER → base64.
// digest: 'sha256' (recomendado por AFIP) o 'sha1' (compatibilidad histórica).
export function signTRA(tra, certPem, keyPem, { digest = 'sha256' } = {}) {
  const cert = forge.pki.certificateFromPem(normalizePem(certPem));
  const key  = forge.pki.privateKeyFromPem(normalizePem(keyPem));
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: digest === 'sha1' ? forge.pki.oids.sha1 : forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

// Extrae el contenido de un tag XML (tolera prefijo de namespace).
function tag(xml, name) {
  const m = String(xml || '').match(new RegExp('<(?:[\\w.-]+:)?' + name + '[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '>'));
  return m ? m[1] : null;
}

function unescapeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function soapEnvelopeLoginCms(cms) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="https://wsaa.view.sua.dgi.gov.ar/">'
    + '<soapenv:Header/>'
    + '<soapenv:Body><wsaa:loginCms><wsaa:in0>' + cms + '</wsaa:in0></wsaa:loginCms></soapenv:Body>'
    + '</soapenv:Envelope>';
}

// Pide un Ticket de Acceso nuevo a WSAA. Devuelve { token, sign, expirationTime, raw }.
// Lanza Error con el detalle de AFIP si falla (los faults de WSAA son descriptivos).
export async function loginWSAA({ certPem, keyPem, service = 'wsfe', env = 'homologacion', digest = 'sha256' }) {
  const now = Date.now();
  // Ventana amplia para tolerar desfasajes de reloj: -10min a +10min.
  const tra = buildLoginTicketRequest({
    service,
    uniqueId:       Math.floor(now / 1000),
    generationTime: new Date(now - 10 * 60 * 1000).toISOString(),
    expirationTime: new Date(now + 10 * 60 * 1000).toISOString(),
  });

  const cms = signTRA(tra, certPem, keyPem, { digest });
  const url = WSAA_URLS[env] || WSAA_URLS.homologacion;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
    body: soapEnvelopeLoginCms(cms),
  });
  const xml = await res.text();

  const fault = tag(xml, 'faultstring');
  if (fault) {
    const err = new Error('WSAA: ' + fault.trim());
    err.wsaaFault = fault.trim();
    throw err;
  }
  if (!res.ok) throw new Error('WSAA HTTP ' + res.status + ': ' + xml.slice(0, 400));

  const ret = tag(xml, 'loginCmsReturn');
  if (!ret) throw new Error('WSAA: respuesta sin loginCmsReturn. ' + xml.slice(0, 400));

  const ta = unescapeXml(ret);
  const token = tag(ta, 'token');
  const sign  = tag(ta, 'sign');
  if (!token || !sign) throw new Error('WSAA: token/sign no encontrados en el TA.');

  return { token, sign, expirationTime: tag(ta, 'expirationTime'), raw: ta };
}
