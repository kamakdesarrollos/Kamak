// Geocodificación de direcciones → coordenadas {lat, lng} para ubicar la obra en
// el mapa de la web pública. Estrategia "la que funcione":
//   1. Google Geocoding si hay API key (VITE_GOOGLE_MAPS_KEY) — más preciso.
//   2. Nominatim (OpenStreetMap) — gratis, sin key, buena precisión para AR.
//   3. Si ambos fallan → null (el usuario carga lat/lng a mano).
// Se llama desde el navegador (pocas obras, volumen bajo → ok con la policy de Nominatim).

const GOOGLE_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_KEY) || '';

// Normaliza el resultado a un {lat, lng} con números finitos, o null.
function coords(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  return (Number.isFinite(la) && Number.isFinite(ln)) ? { lat: la, lng: ln } : null;
}

export async function geocodeDireccion(direccion) {
  const dir = String(direccion || '').trim();
  if (!dir) return null;
  // Anclamos a Argentina para desambiguar (muchas calles se repiten en el país).
  const query = /argentina/i.test(dir) ? dir : `${dir}, Argentina`;

  // 1) Google (si hay key)
  if (GOOGLE_KEY) {
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=ar&key=${GOOGLE_KEY}`
      );
      const j = await r.json();
      const loc = j && j.results && j.results[0] && j.results[0].geometry && j.results[0].geometry.location;
      if (loc) {
        const c = coords(loc.lat, loc.lng);
        if (c) return c;
      }
    } catch (e) {
      console.warn('[geocode] Google falló, voy a Nominatim:', e && e.message);
    }
  }

  // 2) Nominatim (OpenStreetMap) — gratis
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } }
    );
    const j = await r.json();
    const hit = Array.isArray(j) ? j[0] : null;
    if (hit) {
      const c = coords(hit.lat, hit.lon);
      if (c) return c;
    }
  } catch (e) {
    console.warn('[geocode] Nominatim falló:', e && e.message);
  }

  return null;
}
