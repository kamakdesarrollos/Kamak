// WSFE — cliente del WebService de Factura Electrónica de AFIP (WSFEv1).
//
// Habla SOAP con el .asmx de AFIP. Tres operaciones que usamos:
//   • FEDummy                 → salud del servicio (no requiere auth).
//   • FECompUltimoAutorizado  → último número autorizado de un PtoVta+tipo
//                               (para asignar CbteDesde = último + 1).
//   • FECAESolicitar          → pide el CAE de un comprobante (la emisión real).
//
// El Auth (Token + Sign del WSAA + Cuit del emisor) lo arma el caller y se inyecta
// en cada request autenticado. El mapeo del comprobante ya viene hecho y testeado
// desde src/lib/wsfe.js (feCaeSolicitarPayload); acá sólo lo serializamos al XML
// que AFIP espera, RESPETANDO EL ORDEN del XSD (WSFE es estricto con el orden).

const WSFE_URLS = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion:   'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};
const NS = 'http://ar.gov.afip.dif.FEV1/';

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp('<(?:[\\w.-]+:)?' + name + '[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '>'));
  return m ? m[1] : null;
}
// Todas las apariciones de un tag (para listas de errores/observaciones).
function tagAll(xml, name) {
  const re = new RegExp('<(?:[\\w.-]+:)?' + name + '[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '>', 'g');
  const out = []; let m;
  while ((m = re.exec(String(xml || '')))) out.push(m[1]);
  return out;
}
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// POST de un Body SOAP al .asmx. `action` es el método (para el header SOAPAction).
async function soapCall(env, action, bodyInner) {
  const url = WSFE_URLS[env] || WSFE_URLS.homologacion;
  const envelope = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="' + NS + '">'
    + '<soap:Body>' + bodyInner + '</soap:Body></soap:Envelope>';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': NS + action },
    body: envelope,
  });
  const xml = await res.text();
  const fault = tag(xml, 'faultstring');
  if (fault) throw new Error('WSFE ' + action + ': ' + fault.trim());
  if (!res.ok) throw new Error('WSFE ' + action + ' HTTP ' + res.status + ': ' + xml.slice(0, 400));
  return xml;
}

const authXml = ({ token, sign, cuit }) =>
  '<ar:Auth><ar:Token>' + esc(token) + '</ar:Token><ar:Sign>' + esc(sign) + '</ar:Sign>'
  + '<ar:Cuit>' + esc(cuit) + '</ar:Cuit></ar:Auth>';

// Errores y observaciones que devuelve WSFE en la respuesta (estructura común).
function leerErroresYObs(xml) {
  const errs = tagAll(xml, 'Err').map(e => ({ code: tag(e, 'Code'), msg: tag(e, 'Msg') }));
  const obs  = tagAll(xml, 'Obs').map(o => ({ code: tag(o, 'Code'), msg: tag(o, 'Msg') }));
  return { errs, obs };
}

// ── FEDummy: salud del servicio (AppServer/DbServer/AuthServer deben dar OK) ──
export async function feDummy(env) {
  const xml = await soapCall(env, 'FEDummy', '<ar:FEDummy/>');
  return { appServer: tag(xml, 'AppServer'), dbServer: tag(xml, 'DbServer'), authServer: tag(xml, 'AuthServer') };
}

// ── FECompUltimoAutorizado: último N° autorizado de un PtoVta + tipo ──
export async function feCompUltimoAutorizado(env, auth, { ptoVta, cbteTipo }) {
  const body = '<ar:FECompUltimoAutorizado>' + authXml(auth)
    + '<ar:PtoVta>' + Number(ptoVta) + '</ar:PtoVta>'
    + '<ar:CbteTipo>' + Number(cbteTipo) + '</ar:CbteTipo>'
    + '</ar:FECompUltimoAutorizado>';
  const xml = await soapCall(env, 'FECompUltimoAutorizado', body);
  const { errs } = leerErroresYObs(xml);
  if (errs.length) throw new Error('FECompUltimoAutorizado: ' + errs.map(e => `[${e.code}] ${e.msg}`).join(' · '));
  return { ptoVta: Number(tag(xml, 'PtoVta')), cbteTipo: Number(tag(xml, 'CbteTipo')), nro: Number(tag(xml, 'CbteNro')) };
}

// ── FEParamGetPtosVenta: puntos de venta habilitados ──
export async function feParamGetPtosVenta(env, auth) {
  const xml = await soapCall(env, 'FEParamGetPtosVenta', '<ar:FEParamGetPtosVenta>' + authXml(auth) + '</ar:FEParamGetPtosVenta>');
  return tagAll(xml, 'PtoVenta').map(p => ({ nro: Number(tag(p, 'Nro')), tipo: tag(p, 'EmisionTipo'), bloqueado: tag(p, 'Bloqueado') }));
}

// Serializa un FECAEDetRequest RESPETANDO el orden del XSD de WSFEv1.
// El orden importa: AFIP rechaza el comprobante si los campos vienen desordenados.
function detRequestXml(d) {
  const f = [];
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') f.push('<ar:' + k + '>' + esc(v) + '</ar:' + k + '>'); };
  put('Concepto', d.Concepto);
  put('DocTipo', d.DocTipo);
  put('DocNro', d.DocNro);
  put('CbteDesde', d.CbteDesde);
  put('CbteHasta', d.CbteHasta);
  put('CbteFch', d.CbteFch);
  put('ImpTotal', d.ImpTotal);
  put('ImpTotConc', d.ImpTotConc);
  put('ImpNeto', d.ImpNeto);
  put('ImpOpEx', d.ImpOpEx);
  put('ImpTrib', d.ImpTrib);   // ¡ImpTrib va ANTES que ImpIVA en el XSD!
  put('ImpIVA', d.ImpIVA);
  put('FchServDesde', d.FchServDesde);
  put('FchServHasta', d.FchServHasta);
  put('FchVtoPago', d.FchVtoPago);
  put('MonId', d.MonId);
  put('MonCotiz', d.MonCotiz);
  put('CondicionIVAReceptorId', d.CondicionIVAReceptorId);
  if (Array.isArray(d.CbtesAsoc) && d.CbtesAsoc.length) {
    f.push('<ar:CbtesAsoc>' + d.CbtesAsoc.map(a =>
      '<ar:CbteAsoc><ar:Tipo>' + esc(a.Tipo) + '</ar:Tipo><ar:PtoVta>' + esc(a.PtoVta) + '</ar:PtoVta><ar:Nro>' + esc(a.Nro) + '</ar:Nro></ar:CbteAsoc>'
    ).join('') + '</ar:CbtesAsoc>');
  }
  if (Array.isArray(d.Iva) && d.Iva.length) {
    f.push('<ar:Iva>' + d.Iva.map(a =>
      '<ar:AlicIva><ar:Id>' + esc(a.Id) + '</ar:Id><ar:BaseImp>' + esc(a.BaseImp) + '</ar:BaseImp><ar:Importe>' + esc(a.Importe) + '</ar:Importe></ar:AlicIva>'
    ).join('') + '</ar:Iva>');
  }
  return '<ar:FECAEDetRequest>' + f.join('') + '</ar:FECAEDetRequest>';
}

// ── FECAESolicitar: pide el CAE. `payload` = { FeCabReq, FeDetReq:[det] } ──
// Devuelve { resultado: 'A'|'R'|'P', cae, caeVto, nro, obs, errs, raw }.
export async function feCAESolicitar(env, auth, payload) {
  const cab = payload.FeCabReq;
  const cabXml = '<ar:FeCabReq><ar:CantReg>' + Number(cab.CantReg) + '</ar:CantReg>'
    + '<ar:PtoVta>' + Number(cab.PtoVta) + '</ar:PtoVta>'
    + '<ar:CbteTipo>' + Number(cab.CbteTipo) + '</ar:CbteTipo></ar:FeCabReq>';
  const detXml = '<ar:FeDetReq>' + payload.FeDetReq.map(detRequestXml).join('') + '</ar:FeDetReq>';
  const body = '<ar:FECAESolicitar>' + authXml(auth)
    + '<ar:FeCAEReq>' + cabXml + detXml + '</ar:FeCAEReq></ar:FECAESolicitar>';

  const xml = await soapCall(env, 'FECAESolicitar', body);
  const { errs, obs } = leerErroresYObs(xml);
  const resultado = tag(xml, 'Resultado');           // A=aprobado, R=rechazado, P=parcial
  const det = tag(xml, 'FECAEDetResponse') || xml;
  return {
    resultado,
    cae:    tag(det, 'CAE') || null,
    caeVto: tag(det, 'CAEFchVto') || null,
    nro:    Number(tag(det, 'CbteDesde')) || null,
    obs, errs,
    raw: xml,
  };
}

export { WSFE_URLS };
