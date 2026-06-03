import { describe, it, expect } from 'vitest';
import { searchNorm } from './searchNorm';

describe('searchNorm — normalización para búsquedas (sin acentos, minúsculas)', () => {
  it('saca acentos para que "marmol" matchee "Mármol"', () => {
    expect(searchNorm('Mármol')).toBe('marmol');
    expect(searchNorm('marmol')).toBe('marmol');
    expect(searchNorm('Mármol').includes(searchNorm('marmol'))).toBe(true);
  });
  it('minúsculas + acentos varios', () => {
    expect(searchNorm('ILUMINACIÓN')).toBe('iluminacion');
    expect(searchNorm('Instalación Eléctrica')).toBe('instalacion electrica');
  });
  it('ñ → n', () => {
    expect(searchNorm('Caño')).toBe('cano');
  });
  it('tolera null/undefined/números', () => {
    expect(searchNorm(null)).toBe('');
    expect(searchNorm(undefined)).toBe('');
    expect(searchNorm(123)).toBe('123');
  });
});
