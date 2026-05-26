import { describe, it, expect } from 'vitest';
import { newId } from './id';

describe('newId', () => {
  it('usa el prefijo dado', () => {
    expect(newId('mov')).toMatch(/^mov-/);
    expect(newId('chq')).toMatch(/^chq-/);
  });

  it('default prefix es "id"', () => {
    expect(newId()).toMatch(/^id-/);
  });

  it('genera IDs distintos en llamadas consecutivas', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(newId('x'));
    expect(ids.size).toBe(100);
  });

  it('formato: prefix-timestamp-randomsuffix', () => {
    const id = newId('test');
    const parts = id.split('-');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('test');
    expect(parts[1]).toMatch(/^\d+$/);            // timestamp numerico
    expect(parts[2]).toMatch(/^[a-z0-9]+$/);      // suffix alfanumerico
  });
});
