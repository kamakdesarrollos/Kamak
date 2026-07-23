import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseLinkedInZip, planImportLinkedIn } from './importLinkedIn';

// ---------------------------------------------------------------------------
// Fixtures: formatos REALES del export oficial de LinkedIn
// ---------------------------------------------------------------------------

const MI_NOMBRE = 'Franco Espinoza';

const DECISORES = [
  { id: 'd1', nombre: 'Juan Pérez', linkedin_url: 'https://www.linkedin.com/in/juan-perez-9a/' },
  { id: 'd2', nombre: 'María López', linkedin_url: 'linkedin.com/in/maria-lopez' },
  { id: 'd3', nombre: 'Carlos Gómez', linkedin_url: null },
];

// messages.csv: comas dentro de CONTENT entrecomillado + newline dentro de comillas (c3)
// c1: yo escribo primero, Juan responde → contactado + respondio (match por URL con case distinto + query)
// c2: María me escribe primero → NO es contactado mío, y no hay respuesta ajena posterior a un msj mío
// c3: yo escribo, nadie responde; sin URL de destinatario → fallback por nombre sin tildes/case
// c4: yo escribo a un desconocido → sinMatch
const MESSAGES_CSV = `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT
c1,,Franco Espinoza,https://www.linkedin.com/in/franco-esp,Juan Pérez,https://WWW.LinkedIn.com/in/Juan-Perez-9A/?trk=msg,2026-07-10 09:00:00 UTC,,"Hola Juan, ¿cómo estás? Te escribo por la estación, saludos"
c1,,Juan Pérez,https://www.linkedin.com/in/Juan-Perez-9A/,Franco Espinoza,https://www.linkedin.com/in/franco-esp,2026-07-11 15:30:00 UTC,,"Hola Franco, sí, me interesa"
c2,,María López,https://linkedin.com/in/maria-lopez/,Franco Espinoza,https://www.linkedin.com/in/franco-esp,2026-07-12 10:00:00 UTC,,"Hola! Vi tu perfil, ¿hablamos?"
c2,,Franco Espinoza,https://www.linkedin.com/in/franco-esp,María López,https://linkedin.com/in/maria-lopez/,2026-07-12 11:00:00 UTC,,Gracias María
c3,,Franco Espinoza,https://www.linkedin.com/in/franco-esp,CARLOS GOMEZ,,2026-07-13 08:00:00 UTC,,"Mensaje con salto de línea:
segunda línea del mensaje"
c4,,Franco Espinoza,https://www.linkedin.com/in/franco-esp,Pedro Desconocido,https://linkedin.com/in/pedro-x,2026-07-14 09:30:00 UTC,,Hola Pedro
`;

// Connections.csv: arranca con preámbulo de notas (hay que saltearlo hasta el header real)
const CONNECTIONS_CSV = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed it."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Juan,Pérez,https://www.linkedin.com/in/juan-perez-9a,juan@estacion.com,Shell Norte SA,Operador,15 Jul 2026
Ana,Nueva,https://www.linkedin.com/in/ana-nueva,,,Gerenta,14 Jul 2026
`;

// Invitations.csv: Sent At con coma adentro (campo entrecomillado); INCOMING se ignora
const INVITATIONS_CSV = `From,To,Sent At,Message,Direction
Franco Espinoza,maría lópez,"7/9/26, 1:05 PM","Hola María, te sumo a mi red",OUTGOING
Otro Usuario,Franco Espinoza,"7/8/26, 9:00 AM",,INCOMING
Franco Espinoza,Luis Nadie,"7/7/26, 10:00 AM",,OUTGOING
Franco Espinoza,Pedro Desconocido,"7/6/26, 8:00 AM",,OUTGOING
`;

const RAW = { messages: MESSAGES_CSV, connections: CONNECTIONS_CSV, invitations: INVITATIONS_CSV };
const OPTS = { decisores: DECISORES, actividadesPrevias: [], miNombre: MI_NOMBRE };

const plan = () => planImportLinkedIn(RAW, OPTS);
const delTipo = (res, tipo) => res.actividades.filter((a) => a.tipo === tipo);

// ---------------------------------------------------------------------------
// parseLinkedInZip
// ---------------------------------------------------------------------------

describe('parseLinkedInZip — extrae los CSV del ZIP oficial', () => {
  it('encuentra messages/Connections en subcarpetas, case-insensitive; faltante → null', async () => {
    const zip = new JSZip();
    zip.file('Complete_LinkedInDataExport_10-07-2026/MESSAGES.CSV', MESSAGES_CSV);
    zip.file('Complete_LinkedInDataExport_10-07-2026/Connections.csv', CONNECTIONS_CSV);
    const raw = await parseLinkedInZip(zip);
    expect(raw.messages).toContain('CONVERSATION ID');
    expect(raw.connections).toContain('Connected On');
    expect(raw.invitations).toBeNull();
  });

  it('también encuentra archivos en la raíz del zip', async () => {
    const zip = new JSZip();
    zip.file('Invitations.csv', INVITATIONS_CSV);
    const raw = await parseLinkedInZip(zip);
    expect(raw.invitations).toContain('Direction');
    expect(raw.messages).toBeNull();
    expect(raw.connections).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// planImportLinkedIn — messages.csv
// ---------------------------------------------------------------------------

describe('planImportLinkedIn — mensajes', () => {
  it('conversación iniciada por mí con respuesta → linkedin_contactado + linkedin_respondio', () => {
    const res = plan();
    const contactados = delTipo(res, 'linkedin_contactado');
    const c1 = contactados.find((a) => a.datos?.conversationId === 'c1');
    expect(c1).toBeTruthy();
    expect(c1.decisorId).toBe('d1');
    expect(c1.fecha).toBe('2026-07-10T09:00:00.000Z');

    const respondio = delTipo(res, 'linkedin_respondio');
    expect(respondio).toHaveLength(1);
    expect(respondio[0].decisorId).toBe('d1');
    expect(respondio[0].fecha).toBe('2026-07-11T15:30:00.000Z');
  });

  it('match por URL de perfil con distinto case, query string y trailing slash', () => {
    // c1: la única URL que referencia a Juan viene con WWW.LinkedIn.com + ?trk → igual matchea d1
    const res = plan();
    expect(delTipo(res, 'linkedin_contactado').some((a) => a.decisorId === 'd1')).toBe(true);
  });

  it('conversación donde me escriben primero → NO es contactado mío ni respondio', () => {
    const res = plan();
    const deMaria = res.actividades.filter((a) => a.decisorId === 'd2' && a.datos?.conversationId === 'c2');
    expect(deMaria).toHaveLength(0);
  });

  it('fallback de match por nombre completo case-insensitive y sin tildes (CARLOS GOMEZ → Carlos Gómez)', () => {
    const res = plan();
    const c3 = delTipo(res, 'linkedin_contactado').find((a) => a.datos?.conversationId === 'c3');
    expect(c3).toBeTruthy();
    expect(c3.decisorId).toBe('d3');
    expect(c3.fecha).toBe('2026-07-13T08:00:00.000Z');
  });

  it('CONTENT con comas y saltos de línea dentro de comillas no rompe el parseo (RFC4180)', () => {
    // si el parser cortara mal, c3 no existiría o habría filas basura sin conversación válida
    const res = plan();
    expect(delTipo(res, 'linkedin_contactado')).toHaveLength(2); // c1 y c3 (c4 es sinMatch)
  });
});

// ---------------------------------------------------------------------------
// planImportLinkedIn — Connections.csv e Invitations.csv
// ---------------------------------------------------------------------------

describe('planImportLinkedIn — conexiones e invitaciones', () => {
  it('saltea el preámbulo de Connections.csv y genera linkedin_acepto con fecha "15 Jul 2026"', () => {
    const res = plan();
    const aceptos = delTipo(res, 'linkedin_acepto');
    expect(aceptos).toHaveLength(1);
    expect(aceptos[0].decisorId).toBe('d1');
    expect(aceptos[0].fecha).toBe('2026-07-15T00:00:00.000Z');
  });

  it('Invitations OUTGOING → linkedin_invitado (match por nombre); INCOMING se ignora', () => {
    const res = plan();
    const invitados = delTipo(res, 'linkedin_invitado');
    expect(invitados).toHaveLength(1);
    expect(invitados[0].decisorId).toBe('d2');
    expect(invitados[0].fecha.slice(0, 10)).toBe('2026-07-09');
    // "Otro Usuario" (INCOMING) no genera actividad ni sinMatch
    expect(res.sinMatch.some((s) => s.nombre === 'Otro Usuario')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sinMatch + dedup + resumen
// ---------------------------------------------------------------------------

describe('planImportLinkedIn — sinMatch, dedup y resumen', () => {
  it('personas sin match con origen, dedup por nombre entre fuentes', () => {
    const res = plan();
    // Pedro aparece en messages y en invitations → una sola vez (primer origen: messages)
    const pedro = res.sinMatch.filter((s) => s.nombre === 'Pedro Desconocido');
    expect(pedro).toHaveLength(1);
    expect(pedro[0].origen).toBe('messages');
    expect(pedro[0].url).toBe('https://linkedin.com/in/pedro-x');
    const ana = res.sinMatch.find((s) => s.nombre === 'Ana Nueva');
    expect(ana?.origen).toBe('connections');
    const luis = res.sinMatch.find((s) => s.nombre === 'Luis Nadie');
    expect(luis?.origen).toBe('invitations');
    expect(res.sinMatch).toHaveLength(3);
  });

  it('dedup contra actividadesPrevias por conversationId y por fecha-en-día', () => {
    const previas = [
      { tipo: 'linkedin_contactado', decisor_id: 'd1', datos: { conversationId: 'c1' } },
      { tipo: 'linkedin_acepto', decisor_id: 'd1', fecha: '2026-07-15T00:00:00.000Z', datos: {} },
    ];
    const res = planImportLinkedIn(RAW, { ...OPTS, actividadesPrevias: previas });
    expect(delTipo(res, 'linkedin_contactado').some((a) => a.decisorId === 'd1')).toBe(false);
    expect(delTipo(res, 'linkedin_acepto')).toHaveLength(0);
    // el respondio de c1 NO estaba en previas → se genera igual
    expect(delTipo(res, 'linkedin_respondio')).toHaveLength(1);
    expect(res.resumen.duplicadosSalteados).toBe(2);
  });

  it('resumen con conteos correctos en corrida limpia', () => {
    const res = plan();
    expect(res.resumen).toEqual({
      contactados: 2,
      respondieron: 1,
      aceptaron: 1,
      invitados: 1,
      sinMatch: 3,
      duplicadosSalteados: 0,
    });
  });

  it('archivos faltantes (null) no rompen: solo procesa lo que hay', () => {
    const res = planImportLinkedIn({ messages: MESSAGES_CSV, connections: null, invitations: null }, OPTS);
    expect(res.resumen.aceptaron).toBe(0);
    expect(res.resumen.invitados).toBe(0);
    expect(res.resumen.contactados).toBe(2);
  });
});
