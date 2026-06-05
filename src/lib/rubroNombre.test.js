import { describe, it, expect } from 'vitest';
import { formatRubroNombre } from './rubroNombre';

describe('formatRubroNombre — rubros en minúscula con la primera letra en mayúscula', () => {
  it('pasa MAYÚSCULAS a minúscula con inicial mayúscula', () => {
    expect(formatRubroNombre('LOGISTICA')).toBe('Logistica');
    expect(formatRubroNombre('MOBILIARIO SHOP EXPRESS')).toBe('Mobiliario shop express');
  });
  it('si empieza con código/número queda TODO en minúscula (la inicial es la del char 0)', () => {
    expect(formatRubroNombre('47 - LOGISTICA')).toBe('47 - logistica');
    expect(formatRubroNombre('48 - SUPERVISIÓN DE OBRA:')).toBe('48 - supervisión de obra:');
  });
  it('respeta acentos y ñ', () => {
    expect(formatRubroNombre('ÁRIDOS')).toBe('Áridos');
    expect(formatRubroNombre('DEMOLICIÓN')).toBe('Demolición');
    expect(formatRubroNombre('CAÑERÍAS')).toBe('Cañerías');
  });
  it('colapsa espacios y recorta', () => {
    expect(formatRubroNombre('  pintura   general ')).toBe('Pintura general');
  });
  it('tolera vacío / no-string', () => {
    expect(formatRubroNombre('')).toBe('');
    expect(formatRubroNombre(null)).toBe('');
    expect(formatRubroNombre(undefined)).toBe('');
  });
});
