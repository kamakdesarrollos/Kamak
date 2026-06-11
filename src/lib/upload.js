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
