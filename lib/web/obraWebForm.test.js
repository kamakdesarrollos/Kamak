import { describe, it, expect } from 'vitest';
import { parseWebForm, webToForm, avisosPublicar } from './obraWebForm.js';

describe('parseWebForm', () => {
  it('parsea números, coords y texto en párrafos; autoslug', () => {
    const out = parseWebForm({
      titulo: 'Costa Paraná', nombre: 'X', categoria: 'tienda', marca: 'Super 7',
      localidad: 'Baradero', provincia: 'Buenos Aires', m2: '260', diasOverride: '21',
      lat: '-33,8', lng: '-59,5', texto: 'Párrafo uno.\n\nPárrafo dos.', destacada: true, orden: '2', antes: true,
    });
    expect(out.slug).toBe('costa-parana');
    expect(out.m2).toBe(260);
    expect(out.diasOverride).toBe(21);
    expect(out.coords).toEqual({ lat: -33.8, lng: -59.5 });
    expect(out.texto).toEqual(['Párrafo uno.', 'Párrafo dos.']);
    expect(out.orden).toBe(2);
    expect(out.antes).toBe(true);
  });

  it('campos vacíos → nulls/defaults, sin coords parciales', () => {
    const out = parseWebForm({ titulo: 'Necochea', lat: '-38', lng: '' });
    expect(out.m2).toBeNull();
    expect(out.diasOverride).toBeNull();
    expect(out.coords).toBeNull();          // lng vacío → no se arma coords
    expect(out.texto).toEqual([]);
    expect(out.orden).toBe(999);
    expect(out.slug).toBe('necochea');
  });

  it('respeta un slug manual si se ingresó', () => {
    expect(parseWebForm({ titulo: 'Elena Córdoba', slug: 'elena' }).slug).toBe('elena');
  });
});

describe('webToForm', () => {
  it('es el inverso para precargar inputs', () => {
    const web = { titulo: 'T', slug: 's', m2: 100, coords: { lat: -33.8, lng: -59.5 }, texto: ['a', 'b'], orden: 3, antes: true, destacada: false };
    const f = webToForm(web);
    expect(f.m2).toBe(100);
    expect(f.lat).toBe(-33.8);
    expect(f.lng).toBe(-59.5);
    expect(f.texto).toBe('a\n\nb');
    expect(f.orden).toBe(3);
    expect(f.antes).toBe(true);
  });
  it('tolera web vacío', () => {
    const f = webToForm();
    expect(f.titulo).toBe('');
    expect(f.lat).toBe('');
    expect(f.texto).toBe('');
  });
});

describe('avisosPublicar', () => {
  it('lista lo que falta sin bloquear', () => {
    expect(avisosPublicar({})).toContain('Falta la localidad');
    expect(avisosPublicar({})).toContain('No hay fotos cargadas');
    expect(avisosPublicar({ localidad: 'X', m2: 10, gallery: [{ url: 'a' }] })).toEqual([]);
    expect(avisosPublicar({ localidad: 'X', m2: 10, antes: true, imageAfter: 'b.jpg' })).toContain('Modo antes/después activo pero falta marcar las 2 fotos');
  });
});
