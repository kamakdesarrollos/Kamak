import { describe, it, expect } from 'vitest';
import { makeSlug, obraPublic, obrasPublicadas, validateLead, leadFromBody } from './obraPublic.js';

describe('makeSlug', () => {
  it('normaliza acentos y espacios', () => {
    expect(makeSlug('Costa Paraná / Baradero')).toBe('costa-parana-baradero');
    expect(makeSlug('')).toBe('obra');
  });
});

describe('obraPublic', () => {
  const obra = {
    id: 'o1', nombre: 'CAGLE-ELENA', cliente: 'Cagle', gastado: 999, margen: 50, presupuesto: 1000,
    fechaInicio: '2024-11-25', fechaFin: '2024-12-15',
    web: { publicar: true, localidad: 'Elena', provincia: 'Córdoba', marca: 'Shop Express', categoria: 'tienda', m2: 120, antes: true, imageBefore: 'a.jpg', imageAfter: 'b.jpg', gallery: [{ url: 'g1.jpg', caption: 'frente' }], coords: { lat: -32.1, lng: -64.4 }, texto: 'hola', orden: 2 },
  };
  it('NO expone costos, márgenes ni cliente', () => {
    const p = obraPublic(obra);
    expect(p.gastado).toBeUndefined();
    expect(p.margen).toBeUndefined();
    expect(p.presupuesto).toBeUndefined();
    expect(p.cliente).toBeUndefined();
  });
  it('mapea campos web y deriva días', () => {
    const p = obraPublic(obra);
    expect(p.slug).toBe('cagle-elena');
    expect(p.localidad).toBe('Elena');
    expect(p.marca).toBe('Shop Express');
    expect(p.m2).toBe(120);
    expect(p.dias).toBe(20);
    expect(p.antes).toBe(true);
    expect(p.coords).toEqual({ lat: -32.1, lng: -64.4 });
    expect(p.texto).toEqual(['hola']);
  });
  it('usa fallbacks cuando no hay web', () => {
    const p = obraPublic({ nombre: 'Necochea Gas Victoria' });
    expect(p.slug).toBe('necochea-gas-victoria');
    expect(p.m2).toBeNull();
    expect(p.dias).toBeNull();
    expect(p.antes).toBe(false);
    expect(p.gallery).toEqual([]);
    expect(p.orden).toBe(999);
  });
});

describe('obraPublic — whitelist hermético', () => {
  it('devuelve EXACTAMENTE las claves whitelisteadas aunque haya basura en obra/web', () => {
    const hostil = {
      nombre: 'X', cliente: 'secreto', gastado: 1, margen: 2, presupuesto: 3, costoMat: 4, costoMO: 5, notas: 'interno',
      web: { publicar: true, extraField: 'LEAK', orden: 'abc',
        gallery: [{ url: 'g.jpg', caption: 'c', secret: 'LEAK' }],
        coords: { lat: 1, lng: 2, secret: 'LEAK' },
        texto: [{ secret: 'LEAK' }, 'parrafo ok'] },
    };
    const p = obraPublic(hostil);
    const EXPECTED = ['slug', 'titulo', 'nombre', 'localidad', 'provincia', 'marca', 'categoria', 'm2', 'dias', 'antes', 'imageBefore', 'imageAfter', 'gallery', 'portada', 'coords', 'texto', 'destacada', 'orden', 'fechaFin'].sort();
    expect(Object.keys(p).sort()).toEqual(EXPECTED);
    expect(Object.keys(p.gallery[0]).sort()).toEqual(['caption', 'url']);
    expect(Object.keys(p.coords).sort()).toEqual(['lat', 'lng']);
    expect(p.texto).toEqual(['parrafo ok']);       // objetos descartados
    expect(p.orden).toBe(999);                       // 'abc' no-numérico → default
    expect(JSON.stringify(p)).not.toContain('LEAK');
    expect(JSON.stringify(p)).not.toContain('secreto');
    expect(JSON.stringify(p)).not.toContain('interno');
  });
});

describe('obrasPublicadas', () => {
  it('solo incluye publicar:true + finalizada y ordena por orden', () => {
    const blob = { obras: [
      { id: 'a', nombre: 'A', estado: 'finalizada', web: { publicar: true, orden: 5 } },
      { id: 'b', nombre: 'B', estado: 'finalizada', web: { publicar: false } },
      { id: 'c', nombre: 'C', estado: 'finalizada', web: { publicar: true, orden: 1 } },
      { id: 'd', nombre: 'D', estado: 'finalizada' },
      { id: 'e', nombre: 'E', estado: 'activa', web: { publicar: true, orden: 0 } }, // publicada pero NO finalizada → excluida
    ] };
    const out = obrasPublicadas(blob);
    expect(out.map(o => o.nombre)).toEqual(['C', 'A']);
  });
  it('tolera blob vacío', () => {
    expect(obrasPublicadas(null)).toEqual([]);
    expect(obrasPublicadas({})).toEqual([]);
  });
});

describe('validateLead', () => {
  it('rechaza honeypot y exige nombre+contacto', () => {
    expect(validateLead({ _gotcha: 'x', nombre: 'Juan', email: 'a@b.c' }).errors).toContain('honeypot');
    expect(validateLead({ nombre: 'J' }).ok).toBe(false);
    expect(validateLead({ nombre: 'Juan' }).errors).toContain('contacto');
    expect(validateLead({ nombre: 'Juan', telefono: '221' }).ok).toBe(true);
  });
});

describe('leadFromBody', () => {
  it('arma un obra-lead con venta.origen web', () => {
    const lead = leadFromBody({ nombre: 'Juan', empresa: 'ACME', telefono: '221', ubicacion: 'La Plata', tipoProyecto: 'Tienda', m2: '100', plazo: '20 días', marca: 'Super 7', mensaje: 'hola' }, '2026-06-10T12:00:00.000Z');
    expect(lead.esLead).toBe(true);
    expect(lead.estado).toBe('en-presupuesto');
    expect(lead.venta.origen).toBe('web');
    expect(lead.venta.etapa).toBe('prospecto');
    expect(lead.cliente).toBe('ACME');
    expect(lead.notas).toContain('100 m²');
    expect(lead.contacto.telefono).toBe('221');
    expect(lead.venta.changelog[0]).toEqual({ etapa: 'prospecto', fecha: '2026-06-10', usuario: 'sistema' });
  });
});
