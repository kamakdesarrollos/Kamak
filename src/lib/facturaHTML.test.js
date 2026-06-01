import { describe, it, expect } from 'vitest';
import { generarFacturaHTML } from './facturaHTML';

const c = {
  tipoId: 'FA', fecha: '2026-05-30', puntoVenta: 3, numero: 1235,
  neto: 1000000, iva: 210000, alicuota: 21, total: 1210000,
  concepto: 'Honorarios de obra', conceptoAfip: 2,
  receptorNombre: 'ACME SA', receptorCuit: '20-12345678-6', receptorCondicion: 'RI',
  cae: '75123456789012', caeVto: '20260609', estado: 'emitido',
};
const empresa = { razonSocial: 'CONQUIES SOLUCIONES CONSTRUCTIVAS SA', cuit: '30-71795385-8', direccion: 'Calle 42 N°3703', iibbAlicuota: 2.5 };
const qrDataUrl = 'data:image/png;base64,QQ==';

describe('generarFacturaHTML', () => {
  const html = generarFacturaHTML(c, { empresa, qrDataUrl });

  it('incluye letra, código AFIP y número/punto de venta con padding', () => {
    expect(html).toContain('COD 01');          // FA → cod AFIP 1
    expect(html).toContain('>A<');             // letra
    expect(html).toContain('0003');            // punto de venta padded
    expect(html).toContain('00001235');        // número padded
  });

  it('incluye CAE y vencimiento del CAE formateado', () => {
    expect(html).toContain('75123456789012');
    expect(html).toContain('09/06/2026');      // caeVto YYYYMMDD → dd/mm/yyyy
  });

  it('embebe el QR de AFIP', () => {
    expect(html).toContain(`src="${qrDataUrl}"`);
  });

  it('incluye receptor, neto, IVA y total en pesos', () => {
    expect(html).toContain('ACME SA');
    expect(html).toContain('$ 1.000.000,00'); // neto
    expect(html).toContain('$ 210.000,00');   // iva
    expect(html).toContain('$ 1.210.000,00'); // total
    expect(html).toContain('IVA 21%');
  });

  it('usa la identidad visual compartida (acento teal) y membrete con logo', () => {
    expect(html).toContain('#1a9b9c');
    expect(html).toContain('class="fz-logo"');
    expect(html).toContain('/assets/kamak-logo.png');     // logo por defecto
  });

  it('permite override del logo (origin tras el deploy)', () => {
    const h = generarFacturaHTML(c, { empresa, qrDataUrl, logoUrl: 'https://app.kamak.com.ar/assets/kamak-logo.png' });
    expect(h).toContain('src="https://app.kamak.com.ar/assets/kamak-logo.png"');
  });

  it('comprobante exento (sin IVA) muestra Op. Exentas en vez de IVA', () => {
    const exento = generarFacturaHTML({ ...c, iva: 0, tipoId: 'FC' }, { empresa, qrDataUrl });
    expect(exento).toContain('Op. Exentas');
  });
});
