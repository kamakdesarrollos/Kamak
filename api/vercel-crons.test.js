import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// vercel.json vive en la raíz del repo (este test está en api/).
const vercelJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8')
);

// El plan Hobby de Vercel limita la cantidad de cron jobs: con 3 crons el deploy
// volvía a fallar en la etapa de config (~7-8s, antes del build) y Vercel rechazaba
// el vercel.json. El 4to cron 'sales-followups' ya se había quitado a propósito en
// c798a71 (Jun 6) por exactamente este motivo; el seguimiento comercial se dispara a
// mano. Estos tests blindan ese límite para que nadie reintroduzca un cron de más.
const MAX_CRONS_HOBBY = 2;

describe('vercel.json — límite de cron jobs (plan Hobby)', () => {
  const crons = vercelJson.crons || [];

  it(`no supera ${MAX_CRONS_HOBBY} cron jobs`, () => {
    expect(crons.length).toBeLessThanOrEqual(MAX_CRONS_HOBBY);
  });

  it('NO reintroduce el cron de followups (se dispara manualmente, quitado en c798a71)', () => {
    const paths = crons.map(c => c.path);
    expect(paths.some(p => p.includes('job=followups'))).toBe(false);
    expect(paths.some(p => p.includes('sales-followups'))).toBe(false);
  });

  it('conserva los 2 crons que sí deployan OK: reminders + sync-sanfrancisco', () => {
    const paths = crons.map(c => c.path);
    expect(paths.some(p => p.includes('job=reminders'))).toBe(true);
    expect(paths.some(p => p.includes('sync-sanfrancisco'))).toBe(true);
  });

  it('cada cron tiene path absoluto y schedule', () => {
    for (const c of crons) {
      expect(typeof c.path).toBe('string');
      expect(c.path.startsWith('/')).toBe(true);
      expect(typeof c.schedule).toBe('string');
      expect(c.schedule.trim().split(/\s+/)).toHaveLength(5);
    }
  });
});
