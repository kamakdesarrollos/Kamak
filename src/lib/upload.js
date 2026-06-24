import { supabase } from './supabase';

// Helper central para subir una foto/comprobante a Supabase Storage.
// - Si no hay file, devuelve null (no rompe el flujo de guardado).
// - Arma un path único: carpeta/<timestamp-en-ms>.<extension del archivo>.
// - Sube al bucket 'kamak-fotos' con upsert:true y devuelve la public URL.
// - Si la subida falla, lanza Error para que el caller lo maneje.
export async function uploadFoto(file, carpeta = 'general') {
  if (!file) return null;
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  // Sufijo random además del timestamp: dos archivos subidos en el mismo ms (ej.
  // selección múltiple) NO comparten path → no se pisan con upsert ni colisionan URLs.
  const path = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('kamak-fotos').upload(path, file, { upsert: true });
  if (error) throw new Error('No se pudo subir el comprobante: ' + error.message);
  return supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
}

// Bucket PRIVADO para presupuestos de tercero: traen datos comerciales sensibles
// (CUIT, precios de proveedor) y NO deben quedar accesibles por URL pública como
// las fotos (SEC-09). Se accede siempre vía signed URL temporal (getSignedUrl).
const BUCKET_PRESUPUESTOS = 'kamak-presupuestos';

// Sube un adjunto al bucket privado y devuelve { path, bucket } — NO una URL
// pública. El path lleva timestamp + sufijo random para no colisionar.
export async function subirAdjuntoPrivado(file, carpeta = 'presupuestos') {
  if (!file) return null;
  const ext = (file.name?.split('.').pop() || 'pdf').toLowerCase();
  const path = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_PRESUPUESTOS).upload(path, file, { upsert: true });
  if (error) throw new Error('No se pudo subir el presupuesto: ' + error.message);
  return { path, bucket: BUCKET_PRESUPUESTOS };
}

// Genera una URL firmada temporal para leer un objeto de un bucket privado.
export async function getSignedUrl(path, bucket = BUCKET_PRESUPUESTOS, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw new Error('No se pudo generar el enlace: ' + error.message);
  return data.signedUrl;
}

// Borra el objeto de Storage de un adjunto (para no dejarlo huérfano al quitarlo).
export async function borrarAdjuntoPrivado(path, bucket = BUCKET_PRESUPUESTOS) {
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error('No se pudo borrar el archivo: ' + error.message);
}
