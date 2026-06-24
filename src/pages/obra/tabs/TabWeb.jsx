import { useState, useRef, useEffect } from 'react';
import { Box, Btn, Chip } from '../../../components/ui';
import { T } from '../../../theme';
import { uploadFoto } from '../../../lib/upload';
import { geocodeDireccion } from '../../../lib/geocode';
import { FInput, FSelect, FRow, inputSt } from '../forms';
import { useObras } from '../../../store/ObrasContext';
import { webToForm, parseWebForm, avisosPublicar } from '../../../../lib/web/obraWebForm';

// Pestaña "Web" del editor de obra: curar la ficha pública (datos + fotos
// antes/después + galería) y publicar/despublicar. Solo-Admin (gateado en
// ObraPresupuesto via visibleTabIndices). Persiste con setWebObra/togglePublicar
// (atómico, separado de detalle.fotos). El whitelist real lo aplica el endpoint
// público (lib/web/obraPublic). Para delegar el publicar a otros roles en el
// futuro: agregar un flag 'publicarWeb' a la matriz (ver UsuariosContext) y
// gatear con `isAdmin || currentUser?.permisos?.publicarWeb`.

const CATEGORIAS = ['', 'Tienda', 'Comercial'];

export default function TabWeb({ obra, obraId }) {
  const { setWebObra, togglePublicar } = useObras();
  const web = obra.web || {};
  const gallery = web.gallery || [];
  const publicada = !!web.publicar;
  const esFinalizada = obra.estado === 'finalizada';
  const avisos = avisosPublicar(web);

  const [form, setForm] = useState(() => webToForm(web));
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Guardar la ficha (campos de texto). `antes` lo maneja la sección de fotos,
  // así que lo descartamos del patch para no pisarlo.
  const guardarFicha = () => {
    const fichaPatch = parseWebForm({ ...form, nombre: obra.nombre });
    delete fichaPatch.antes;   // `antes` lo maneja la sección de fotos, no la ficha
    setWebObra(obraId, fichaPatch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const subirFotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const nuevas = [];
      for (const f of files) {
        const url = await uploadFoto(f, `obras/${obraId}/web`);
        if (url) nuevas.push({ url, caption: '' });
      }
      if (nuevas.length) setWebObra(obraId, { gallery: [...gallery, ...nuevas] });
    } catch (err) {
      window.alert('No se pudo subir la foto: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const quitarFoto = (url) => {
    const patch = { gallery: gallery.filter(g => g.url !== url) };
    if (web.imageBefore === url) patch.imageBefore = null;
    if (web.imageAfter === url) patch.imageAfter = null;
    if (web.portada === url) patch.portada = null;
    setWebObra(obraId, patch);
  };

  // Despublicar (sacar de la web) se puede SIEMPRE; publicar solo si finalizada.
  const puedeAccionar = publicada || esFinalizada;
  const publicar = () => { if (puedeAccionar) togglePublicar(obraId, !publicada); };

  // ── Ubicación automática desde la dirección de la obra ──────────────────────
  // Geocodifica obra.direccion → coords del mapa de la web. Auto-detecta al abrir
  // si la obra no tiene coords; también hay botón para re-ubicar. Persiste atómico.
  const [geoStatus, setGeoStatus] = useState('');   // '' | 'buscando' | 'ok' | 'nada'
  const ubicarDesdeDireccion = async () => {
    if (!obra.direccion) { setGeoStatus('nada'); return; }
    setGeoStatus('buscando');
    const c = await geocodeDireccion(obra.direccion);
    if (c) {
      setF('lat', String(c.lat));
      setF('lng', String(c.lng));
      setWebObra(obraId, { coords: c });   // persiste → el mapa de la web lo toma
      setGeoStatus('ok');
    } else {
      setGeoStatus('nada');
    }
  };
  useEffect(() => {
    // Auto-ubicar al abrir la pestaña si hay dirección cargada y todavía no hay coords.
    if (obra.direccion && web.coords == null) ubicarDesdeDireccion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marcar antes/después evitando que la MISMA foto quede en ambos lados.
  const marcarAntes = (url) => setWebObra(obraId, {
    imageBefore: web.imageBefore === url ? null : url,
    imageAfter: web.imageAfter === url ? null : web.imageAfter,
    antes: true,
  });
  const marcarDespues = (url) => setWebObra(obraId, {
    imageAfter: web.imageAfter === url ? null : url,
    imageBefore: web.imageBefore === url ? null : web.imageBefore,
    antes: true,
  });

  const roleOf = (url) => {
    if (web.imageBefore === url) return 'Antes';
    if (web.imageAfter === url) return 'Después';
    if (web.portada === url) return 'Portada';
    return null;
  };

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Estado de publicación ── */}
      <Box style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
              background: publicada ? (esFinalizada ? T.ok : T.warn) : T.faint, color: publicada ? '#fff' : T.ink2,
            }}>{publicada ? (esFinalizada ? '● Publicada en la web' : '● Publicada (oculta: no finalizada)') : '○ Borrador (no visible)'}</span>
            {web.slug && <span style={{ fontSize: 11, color: T.ink3, fontFamily: `'JetBrains Mono', monospace` }}>/obras/{web.slug}</span>}
          </div>
          <Btn sm accent={!publicada} onClick={publicar}
            style={!puedeAccionar ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
            title={!puedeAccionar ? 'Solo se publican obras finalizadas' : ''}>
            {publicada ? 'Despublicar' : 'Publicar'}
          </Btn>
        </div>
        {!esFinalizada && (
          <div style={{ fontSize: 11.5, color: T.warn }}>
            Esta obra está en estado <b>{obra.estado}</b>. Solo se publican obras <b>finalizadas</b>.
          </div>
        )}
        {avisos.length > 0 && (
          <div style={{ fontSize: 11.5, color: T.ink2 }}>
            <b>Para completar:</b> {avisos.join(' · ')} <span style={{ color: T.ink3 }}>(podés publicar igual)</span>
          </div>
        )}
      </Box>

      {/* ── Ficha (datos) ── */}
      <Box style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Datos de la ficha</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FInput label="Título" value={form.titulo} onChange={v => setF('titulo', v)} placeholder={obra.nombre} />
          <FInput label="Slug (URL)" value={form.slug} onChange={v => setF('slug', v)} placeholder="auto desde el título" />
          <FSelect label="Categoría" value={form.categoria} onChange={v => setF('categoria', v)} options={CATEGORIAS} />
          <FInput label="Marca / formato" value={form.marca} onChange={v => setF('marca', v)} placeholder="Shop Express, Super 7…" />
          <FInput label="Localidad" value={form.localidad} onChange={v => setF('localidad', v)} />
          <FInput label="Provincia" value={form.provincia} onChange={v => setF('provincia', v)} />
          <FInput label="m²" value={form.m2} onChange={v => setF('m2', v)} type="number" placeholder="(en blanco si no se sabe)" />
          <FInput label="Días de obra (override)" value={form.diasOverride} onChange={v => setF('diasOverride', v)} type="number" placeholder="si no, se calcula por fechas" />
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
            <Btn sm onClick={ubicarDesdeDireccion} style={geoStatus === 'buscando' ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
              📍 {geoStatus === 'buscando' ? 'Ubicando…' : 'Ubicar desde la dirección'}
            </Btn>
            <span style={{ fontSize: 10.5, color: T.ink3 }}>
              {obra.direccion ? `Dirección: ${obra.direccion}` : '⚠ La obra no tiene dirección cargada (editala en la obra).'}
              {geoStatus === 'ok' && <b style={{ color: T.ok, marginLeft: 6 }}>✓ Ubicada — guardá la ficha para fijarla.</b>}
              {geoStatus === 'nada' && obra.direccion && <b style={{ color: T.warn, marginLeft: 6 }}>No se encontró — cargá lat/lng a mano.</b>}
            </span>
          </div>
          <FInput label="Mapa · Latitud" value={form.lat} onChange={v => setF('lat', v)} placeholder="-38.55" />
          <FInput label="Mapa · Longitud" value={form.lng} onChange={v => setF('lng', v)} placeholder="-58.74" />
          <FInput label="Orden (menor = primero)" value={form.orden} onChange={v => setF('orden', v)} type="number" />
          <FRow label="Destacada en home">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', padding: '5px 0' }}>
              <input type="checkbox" checked={!!form.destacada} onChange={e => setF('destacada', e.target.checked)} />
              Mostrar entre las destacadas
            </label>
          </FRow>
        </div>
        <FRow label="Texto / descripción (un párrafo por bloque, separá con línea en blanco)">
          <textarea style={{ ...inputSt, minHeight: 90, resize: 'vertical', fontFamily: T.font }}
            value={form.texto} onChange={e => setF('texto', e.target.value)}
            placeholder={'De estación apagada a tienda que factura…\n\nSegundo párrafo opcional.'} />
        </FRow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
          {saved && <span style={{ fontSize: 11.5, color: T.ok }}>✓ Guardado</span>}
          <Btn sm accent onClick={guardarFicha}>Guardar ficha</Btn>
        </div>
      </Box>

      {/* ── Fotos web ── */}
      <Box style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Fotos web ({gallery.length})</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!web.antes} onChange={() => setWebObra(obraId, { antes: !web.antes })} />
              Mostrar como slider <b>Antes/Después</b>
            </label>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={subirFotos} />
            <Btn sm fill onClick={() => fileRef.current?.click()}
              style={uploading ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
              {uploading ? 'Subiendo…' : '+ Subir fotos'}
            </Btn>
          </div>
        </div>

        {web.antes && (!web.imageBefore || !web.imageAfter) && (
          <div style={{ fontSize: 11.5, color: T.warn }}>Modo Antes/Después activo: marcá una foto como <b>Antes</b> y otra como <b>Después</b>.</div>
        )}

        {gallery.length === 0 ? (
          <div style={{ color: T.ink3, padding: 20, textAlign: 'center', fontSize: 12.5 }}>
            Sin fotos web. Subí fotos acá (van al storage de la obra, carpeta <code>web</code>) o se cargan en el seeding masivo.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {gallery.map((g) => {
              const role = roleOf(g.url);
              return (
                <div key={g.url} style={{ border: `1.5px solid ${role ? T.accent : T.faint2}`, borderRadius: 6, overflow: 'hidden', position: 'relative', background: T.paper }}>
                  <a href={g.url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '4/3', overflow: 'hidden' }}>
                    <img src={g.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </a>
                  {role && <Chip style={{ position: 'absolute', top: 4, left: 4, fontSize: 9 }}>{role}</Chip>}
                  <span onClick={() => quitarFoto(g.url)} role="button" aria-label="Quitar foto"
                    style={{ position: 'absolute', top: 3, right: 5, color: '#fff', background: 'rgba(0,0,0,.45)', borderRadius: 10, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12 }}>✕</span>
                  <div style={{ display: 'flex', gap: 4, padding: 5, flexWrap: 'wrap' }}>
                    <MiniBtn on={web.portada === g.url} onClick={() => setWebObra(obraId, { portada: web.portada === g.url ? null : g.url })}>Portada</MiniBtn>
                    <MiniBtn on={web.imageBefore === g.url} onClick={() => marcarAntes(g.url)}>Antes</MiniBtn>
                    <MiniBtn on={web.imageAfter === g.url} onClick={() => marcarDespues(g.url)}>Después</MiniBtn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Box>
    </div>
  );
}

function MiniBtn({ on, onClick, children }) {
  return (
    <span onClick={onClick} role="button"
      style={{
        fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 3, cursor: 'pointer', userSelect: 'none',
        background: on ? T.accent : T.faint, color: on ? '#fff' : T.ink2, border: `1px solid ${on ? T.accent : T.faint2}`,
      }}>{children}</span>
  );
}
