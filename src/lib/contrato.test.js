import { describe, it, expect } from 'vitest';
import { escapeHtml, renderPlantilla, hashDocumento } from './contrato.js';

describe('escapeHtml', () => {
  it('escapa caracteres peligrosos (anti-XSS en placeholders)', () => {
    expect(escapeHtml('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  });
});

describe('renderPlantilla', () => {
  it('resuelve placeholders escapando los valores', () => {
    const html = renderPlantilla('Hola {{cliente.nombre}} ({{cliente.cuit}})', { 'cliente.nombre': 'Juan <script>', 'cliente.cuit': '20-1-3' });
    expect(html).toBe('Hola Juan &lt;script&gt; (20-1-3)');
  });
  it('un placeholder sin valor queda vacío', () => {
    expect(renderPlantilla('a{{falta}}b', {})).toBe('ab');
  });
  it('NO escapa el placeholder planCuotas (es HTML de tabla generado por nosotros)', () => {
    expect(renderPlantilla('{{planCuotas}}', { planCuotas: '<table><tr><td>1</td></tr></table>' })).toContain('<table>');
  });
});

describe('hashDocumento', () => {
  it('sha256 estable e idéntico para el mismo input', () => {
    expect(hashDocumento('abc')).toBe(hashDocumento('abc'));
    expect(hashDocumento('abc')).toMatch(/^[a-f0-9]{64}$/);
  });
});
