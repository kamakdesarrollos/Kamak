// Helpers para generar el link wa.me + QR que el cliente usa para vincularse
// con el bot de WhatsApp.
//
// Flujo:
// 1) El cliente toca el link (o escanea el QR) impreso en el presupuesto
//    o mostrado en la app.
// 2) Se le abre WhatsApp con un mensaje pre-armado del tipo
//    "Hola soy Familia Pérez obra Casa Belgrano".
// 3) Al enviar el mensaje, el bot recibe ese texto, identifica al cliente
//    por nombre + obra, lo vincula y le manda el link al portal.

import { META_PHONE_NUMBER } from './constants';
import QRCode from 'qrcode';

/**
 * Arma el texto del primer mensaje que el cliente le manda al bot.
 * Lo identifica univocamente para que el bot lo matchee sin ambiguedad.
 */
export function buildClientePrimerMensaje(clienteNombre, obraNombre) {
  return `Hola soy ${clienteNombre} obra ${obraNombre}`;
}

/**
 * Arma el link click-to-chat de WhatsApp con texto pre-armado.
 * Ej: https://wa.me/5492262223704?text=Hola%20soy%20...
 */
export function buildWaMeLink(clienteNombre, obraNombre, phoneNumber = META_PHONE_NUMBER) {
  const texto = buildClientePrimerMensaje(clienteNombre, obraNombre);
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(texto)}`;
}

/**
 * Genera un Data URL (base64) con el QR del link. Se embebe directo en
 * <img src={dataUrl}> sin necesidad de red externa.
 *
 * Devuelve null si la generacion falla (ej. valores invalidos).
 */
export async function generateQrDataUrl(value, size = 280) {
  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: size,
      margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
  } catch (e) {
    console.error('generateQrDataUrl error:', e);
    return null;
  }
}
