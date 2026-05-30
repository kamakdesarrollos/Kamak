import { describe, it, expect } from 'vitest';
import { desglosarCompra, fingerprintRecibido } from './afip';
import { desglosarCompraBot, fingerprintRecibidoBot } from '../../api/whatsapp/webhook.js';

// El bot (api/, self-contained) DUPLICA la lógica fiscal de afip.js en funciones
// espejo. La sesión pasada un desfasaje entre copias generó el bug crítico (la
// caja descontaba el neto en vez del total). Estos tests fuerzan que las copias
// NO diverjan: si alguien edita una y no la otra, fallan.

const CASOS = [
  { total: 1210000, tipoLetra: 'A' },                                   // factura A simple
  { total: 1210000, tipoLetra: 'A', percepcionIIBB: 10000 },            // + percep IIBB
  { total: 1240000, tipoLetra: 'A', percepcionIVA: 30000 },             // + percep IVA
  { total: 1250000, tipoLetra: 'A', percepcionIIBB: 10000, percepcionIVA: 30000 }, // ambas
  { total: 1105000, tipoLetra: 'A', montoNeto: 1000000 },               // neto discriminado → 10,5%
  { total: 1210000, tipoLetra: 'B' },                                   // factura B
  { total: 50000,   tipoLetra: 'C' },                                   // factura C (sin IVA crédito)
  { total: 0,       tipoLetra: 'A' },                                   // total inválido
];

describe('paridad desglosarCompraBot (webhook) ≡ desglosarCompra (afip)', () => {
  CASOS.forEach((c, i) => {
    it(`caso ${i + 1}: ${JSON.stringify(c)}`, () => {
      const bot = desglosarCompraBot(c);
      const lib = desglosarCompra(c);
      expect(bot.neto).toBeCloseTo(lib.neto, 2);
      expect(bot.iva).toBeCloseTo(lib.iva, 2);
      expect(bot.alicuota).toBe(lib.alicuota);
      expect(bot.total).toBe(lib.total);
      expect(bot.baseFiscal).toBe(lib.baseFiscal);
    });
  });

  it('invariante crítica: el TOTAL se preserva — la caja descuenta el total, no el neto', () => {
    // Factura A con neto discriminado: el desglose da el neto/IVA para el Libro
    // IVA, pero el `total` (lo que sale de caja) sigue siendo el total completo.
    const r = desglosarCompraBot({ total: 1210000, tipoLetra: 'A', montoNeto: 1000000 });
    expect(r.total).toBe(1210000);          // ← lo que descuenta la caja
    expect(r.neto).toBe(1000000);           // ← solo el desglose fiscal
    expect(r.neto).toBeLessThan(r.total);
  });

  it('las percepciones salen de la base, no inflan el IVA crédito (en ambas copias)', () => {
    const bot = desglosarCompraBot({ total: 1250000, tipoLetra: 'A', percepcionIIBB: 10000, percepcionIVA: 30000 });
    expect(bot.baseFiscal).toBe(1210000);   // 1.250.000 − 10.000 − 30.000
    expect(bot.iva).toBe(210000);
    expect(bot.total).toBe(1250000);        // la caja descuenta el total con percepciones
  });
});

describe('paridad fingerprintRecibidoBot ≡ fingerprintRecibido (anti-duplicado)', () => {
  it('misma huella para factura y para NC en ambas implementaciones', () => {
    const f = { tipo: 'A', numero: '0001-12345', cuit: '30717953858', total: 12000 };
    expect(fingerprintRecibidoBot(f)).toBe(fingerprintRecibido(f));
    const nc = { ...f, clase: 'nota_credito' };
    expect(fingerprintRecibidoBot(nc)).toBe(fingerprintRecibido(nc));
  });

  it('la NC no colisiona con su factura en la copia del bot', () => {
    const f  = { tipo: 'A', numero: '0001-12345', cuit: '30717953858', total: 12000 };
    const nc = { ...f, clase: 'nota_credito' };
    expect(fingerprintRecibidoBot(nc)).not.toBe(fingerprintRecibidoBot(f));
  });

  it('normaliza el serial igual que afip (guiones y ceros a la izquierda)', () => {
    const a = fingerprintRecibidoBot({ tipo: 'A', numero: '0001-00012345', cuit: '30-71795385-8', total: 12000 });
    const b = fingerprintRecibidoBot({ tipo: 'A', numero: '12345', cuit: '30717953858', total: 12000 });
    expect(a).toBe(b);
  });
});
