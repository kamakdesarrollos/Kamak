import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const pick = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const supabase = createClient(pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL'), pick('SUPABASE_SERVICE_KEY'));
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');   // re-siembra (pisa) las plantillas
const KEY = 'crm_plantillas_contratistas';
const get = async (key) => { const { data: row } = await supabase.from('shared_data').select('*').eq('key', key).single(); if (!row) return { row: null, col: 'data', val: null }; const col = row.data !== undefined ? 'data' : 'value'; return { row, col, val: row[col] }; };

// Razón social fija (editable luego desde el editor).
const CONQUIES = `CONQUIES SOLUCIONES CONSTRUCTIVAS S.A.`;

const CLAUSULA_PROP_OBRA = `<h4>16. Propiedad de la documentación, contenido y derechos de imagen</h4>
<p>16.1. Toda la documentación, información técnica, planos, contenidos, fotografías, videos, imágenes y cualquier otro material generado, registrado, captado u obtenido durante o con motivo de la ejecución de la obra (en adelante, el "Material") es de propiedad exclusiva de LA CONTRATANTE, ${CONQUIES}.</p>
<p>16.2. EL LOCADOR, su personal y/o colaboradores se obligan a no utilizar, reproducir, publicar, difundir, exhibir ni comercializar el Material —ni total ni parcialmente— para fines personales, publicitarios, comerciales o de cualquier otra índole, sea en redes sociales, sitios web, portfolios, medios de comunicación o cualquier otro soporte o plataforma, sin la autorización previa, expresa y por escrito de LA CONTRATANTE.</p>
<p>16.3. La presente obligación rige durante toda la vigencia del contrato y subsiste por el plazo de cinco (5) años posteriores a su finalización. El incumplimiento facultará a LA CONTRATANTE a reclamar los daños y perjuicios ocasionados y a aplicar la cláusula penal prevista, sin perjuicio de las acciones civiles y penales que pudieran corresponder.</p>`;

const CLAUSULA_PROP_SERV = `<h4>11. Propiedad de la documentación, contenido y derechos de imagen</h4>
<p>11.1. Toda la documentación, contenidos, fotografías, videos, imágenes y cualquier otro material generado, registrado u obtenido durante o con motivo de la ejecución de la obra (el "Material") es de propiedad exclusiva de la empresa comitente, ${CONQUIES}.</p>
<p>11.2. EL LOCADOR se obliga a no utilizar, reproducir, publicar, difundir, exhibir ni comercializar el Material —ni total ni parcialmente— para fines personales, publicitarios, comerciales o de cualquier otra índole, sea en redes sociales, sitios web, portfolios, medios de comunicación o cualquier otro soporte, sin la autorización previa, expresa y por escrito de ${CONQUIES}.</p>
<p>11.3. La obligación rige durante la vigencia del contrato y por cinco (5) años posteriores, bajo apercibimiento de responder por los daños y perjuicios ocasionados y las acciones civiles y penales que correspondan.</p>`;

const PLANTILLAS = [
  {
    id: 'pl-carta-oferta', tipo: 'carta_oferta', nombre: 'Anexo I — Carta Oferta',
    html: `<h2 style="text-align:center">Carta de Oferta</h2>
<p>{{lugar}}, {{fecha}}</p>
<p>A la atención de<br>${CONQUIES}<br>Calle 42 N°3703, Necochea, Provincia de Buenos Aires<br>CUIT: 30-71795385-8</p>
<p><b>Propuesta de Ejecución de Tareas en Obra</b></p>
<p>Por medio de la presente, me dirijo a Uds. en mi carácter de contratista independiente, inscripto en el Régimen de Trabajadores Independientes con Colaboradores (PADIC), a efectos de presentar mi propuesta profesional para la ejecución de tareas de {{tareasResumen}}, en el marco de la obra a desarrollarse en {{obra.direccion}}.</p>
<p>La presente propuesta incluye:</p>
<ul>
<li>Ejecución integral de los trabajos mencionados, bajo dirección y responsabilidad técnica propia.</li>
<li>Afectación de personal registrado como colaborador en el marco del Régimen PADIC, debidamente declarado ante AFIP.</li>
<li>Contratación de pólizas de seguros correspondientes para todo el equipo involucrado.</li>
<li>Facturación formal contra avance de obra.</li>
<li>Aportes y cumplimiento íntegro de las obligaciones fiscales, previsionales y legales aplicables a mi figura como prestador.</li>
</ul>
<p>Me comprometo a ejecutar las tareas bajo estrictos estándares de calidad, seguridad e independencia, y a mantener indemne a ${CONQUIES} frente a cualquier tipo de reclamo, daño o perjuicio que pudiera derivarse de mi accionar o el de mi equipo.</p>
<p>Quedo a disposición para acordar términos específicos y coordinar fecha de inicio de tareas. Sin otro particular, saludo atentamente,</p>
<p>Firma: ____________________<br>Nombre: {{contratista.nombre}}<br>CUIT: {{contratista.cuit}}<br>Domicilio: {{contratista.domicilio}}</p>`,
  },
  {
    id: 'pl-aceptacion', tipo: 'aceptacion', nombre: 'Anexo II — Aceptación de la Oferta',
    html: `<h2 style="text-align:center">Aceptación de Oferta y Reserva de Obra</h2>
<p>{{lugar}}, {{fecha}}</p>
<p>Sr./Sra. {{contratista.nombre}}<br>Domicilio: {{contratista.domicilio}}<br>CUIT N°: {{contratista.cuit}}</p>
<p>Obra: {{obra.direccion}}</p>
<p>De mi consideración:</p>
<p>Me dirijo a usted en mi carácter de representante legal de ${CONQUIES}, CUIT N° 30-71795385-8, con domicilio en Calle 42 N°3703 de la ciudad de Necochea, provincia de Buenos Aires, a fin de comunicarle que esta sociedad ha resuelto aceptar formalmente la carta de oferta que usted presentara, por la cual se propuso como prestador de servicios bajo el Régimen PADIC para la realización de las tareas allí detalladas en la obra referenciada.</p>
<p>En virtud de la presente aceptación se reservan a su favor, con carácter exclusivo, las tareas indicadas en su oferta. La presente aceptación se formula dentro de una relación estrictamente civil y autónoma, sin que configure vínculo laboral alguno (arts. 21 y 23 LCT; arts. 1251 y ss. CCCN). La relación quedará perfeccionada mediante la firma del Contrato de Locación de Obra.</p>
<p>El comienzo efectivo de los trabajos se hallará condicionado a la presentación de: a) Constancia de inscripción vigente en AFIP – PADIC y categoría de Monotributo; b) Póliza de Responsabilidad Civil y seguro de Accidentes Personales vigentes; c) Nómina completa de colaboradores con sus constancias PADIC y certificados de seguridad e higiene; d) Cualquier otro documento que ${CONQUIES} o la legislación requieran.</p>
<p>Sin otro particular, saludamos a usted muy atentamente.</p>
<p>${CONQUIES}<br>Representante legal: Franco Guillermo Emanuel Espinoza<br>DNI N°: 37.926.961<br>Tel: 2262559474</p>`,
  },
  {
    id: 'pl-nomina', tipo: 'nomina_colaboradores', nombre: 'Anexo III — Nómina de Colaboradores',
    html: `<h2 style="text-align:center">Anexo III — Nómina de Colaboradores y Constancias PADIC</h2>
<p>Contratista (Líder PADIC): {{contratista.nombre}} — CUIT {{contratista.cuit}}</p>
<p>Obra: {{obra.direccion}}</p>
<p>Se declara la siguiente nómina de colaboradores afectados a la obra, todos inscriptos en el Régimen PADIC:</p>
{{nominaTabla}}
<p style="margin-top:10px">El contratista se obliga a presentar las constancias de inscripción PADIC, certificados de seguros y de capacitación en seguridad e higiene de cada colaborador antes de su ingreso a obra.</p>`,
  },
  {
    id: 'pl-plan-trabajo', tipo: 'plan_trabajo', nombre: 'Anexo IV — Plan de Trabajo con Costos',
    html: `<h2 style="text-align:center">Anexo IV — Plan de Trabajo con Costos</h2>
<p>Contratista: {{contratista.nombre}} — CUIT {{contratista.cuit}}</p>
<p>Obra: {{obra.direccion}}</p>
{{tareasTabla}}
<p style="margin-top:12px"><b>Plan de pagos:</b></p>
{{planPagosTabla}}`,
  },
  {
    id: 'pl-locacion-obra', tipo: 'locacion_obra', nombre: 'Contrato de Locación de Obra',
    html: `<h2 style="text-align:center">CONTRATO DE LOCACIÓN DE OBRA</h2>
<h4>1. Partes</h4>
<p>Entre ${CONQUIES} (en adelante, "LA CONTRATANTE"), CUIT N° 30-71795385-8, con domicilio en calle 42 N°3703 de la ciudad de Necochea, provincia de Buenos Aires; y {{contratista.nombre}} (en adelante, "EL LOCADOR"), CUIT N° {{contratista.cuit}}, inscripto en el Régimen PADIC como monotributista categoría {{contratista.categoriaPADIC}}, con domicilio real en {{contratista.domicilio}}, convienen celebrar el presente Contrato de Locación de Obra, conforme a las cláusulas que siguen y a los anexos que forman parte integrante del mismo (Anexo I – Carta Oferta; Anexo II – Aceptación; Anexo III – Nómina de Colaboradores y Constancias PADIC; Anexo IV – Plan de Trabajo con costos; Anexo V – Pólizas y Certificados de Cobertura).</p>
<h4>2. Objeto</h4>
<p>2.1. EL LOCADOR se obliga a ejecutar, por su cuenta y riesgo, las tareas detalladas en la Carta Oferta (Anexo I), en la obra sita en {{obra.direccion}}, conforme a las especificaciones técnicas que oportunamente le entregue LA CONTRATANTE. 2.2. La obligación asumida es de resultado (arts. 1251 y ss. CCCN).</p>
<h4>3. Carácter independiente</h4>
<p>3.1. No existe relación de dependencia alguna; EL LOCADOR actuará con plena autonomía técnica, económica y organizativa. 3.2. Informará por escrito, previo al ingreso a obra, los datos de cada colaborador (nombre, CUIT, categoría PADIC, tarea, cobertura de seguro). 3.3. Toda modificación en la nómina se notificará con al menos 24 h de anticipación.</p>
<h4>4. Precio – Forma y condiciones de pago</h4>
<p>4.1. El precio total de la Obra se fija en {{montoTotal}}, desagregado por ítems en el Anexo IV. 4.2. Plan de pagos:</p>
{{planPagosTabla}}
<p>4.3. El precio incluye tributos, cargas sociales, seguros, viáticos, herramientas y todo gasto necesario. 4.4. LA CONTRATANTE podrá retener hasta un 10% como fondo de garantía, liberable a los 75 días corridos de la recepción definitiva.</p>
<h4>5. Plazo de ejecución</h4>
<p>5.1. Inicio: {{fechaInicio}}. 5.2. Plazo: {{plazo}}. 5.3. Conclusión anticipada: EL LOCADOR deberá notificarlo fehacientemente; LA CONTRATANTE contará con 5 días hábiles para inspección y recepción provisoria.</p>
<h4>6. Seguridad, higiene y seguros</h4>
<p>6.1. EL LOCADOR declara disponer de cobertura de Responsabilidad Civil profesional y general y Seguro de Accidentes Personales para cada colaborador, vigentes durante toda la obra. 6.2. Deberá remitir constancias actualizadas antes del inicio; la omisión habilita la rescisión.</p>
<h4>7. Responsabilidad – Indemnidad</h4>
<p>7.1. EL LOCADOR asume plena responsabilidad por los daños ocasionados a terceros, a LA CONTRATANTE o a su personal (arts. 1716 y ss. CCCN). 7.2. Mantendrá indemne a LA CONTRATANTE frente a cualquier reclamo laboral, previsional, fiscal o sindical de sus colaboradores.</p>
<h4>8. Confidencialidad</h4>
<p>EL LOCADOR y su personal se obligan a guardar confidencialidad sobre toda información técnica, comercial o de otra índole relacionada con LA CONTRATANTE, durante la obra y por 5 años posteriores.</p>
<h4>9. Multa por incumplimiento (cláusula penal)</h4>
<p>Cada día de demora o incumplimiento parcial generará a cargo del incumplidor una multa de $50.000 por día, exigible sin necesidad de interpelación.</p>
<h4>10. Divergencias técnicas</h4>
<p>Toda discusión sobre la correcta ejecución de la obra será sometida a la decisión de un perito arquitecto designado por LA CONTRATANTE.</p>
<h4>11. Subcontratación</h4>
<p>Prohibida salvo autorización escrita de LA CONTRATANTE; EL LOCADOR responderá solidariamente por los subcontratistas autorizados.</p>
<h4>12. Fuerza mayor</h4>
<p>Los supuestos del art. 1730 CCCN deberán notificarse dentro de 48 h, acreditarse fehacientemente y no eximen de adoptar medidas de mitigación.</p>
<h4>13. Rescisión</h4>
<p>13.1. Por causa: LA CONTRATANTE podrá rescindir inmediatamente si EL LOCADOR omite la inscripción/constancias PADIC, no presenta seguros, introduce personal no declarado, incumple el plazo en más de 10 días o viola la confidencialidad; aplicándose la multa y afectándose el fondo de garantía. 13.2. Sin causa: cualquiera de las partes podrá desvincularse con 5 días de preaviso escrito, abonándose los trabajos certificados a esa fecha.</p>
<h4>14. Cesión</h4>
<p>EL LOCADOR no podrá ceder el contrato sin autorización expresa de LA CONTRATANTE. Esta última podrá cederlo a sociedades vinculadas sin requerir aprobación.</p>
<h4>15. Jurisdicción y domicilio</h4>
<p>Para cualquier controversia, las partes se someten a los Tribunales Ordinarios de la Ciudad de Necochea, Provincia de Buenos Aires, renunciando a cualquier otro fuero. Se consideran válidas las notificaciones cursadas a los domicilios indicados.</p>
${CLAUSULA_PROP_OBRA}
<p style="margin-top:18px">En prueba de conformidad, se firman dos ejemplares de un mismo tenor, en {{lugar}}, {{fecha}}.</p>
<table style="width:100%;margin-top:30px"><tr><td style="text-align:center">______________________<br>POR LA CONTRATANTE<br>${CONQUIES}<br>Rep. Legal: Franco Guillermo Emanuel Espinoza — DNI 37.926.961</td><td style="text-align:center">______________________<br>POR EL LOCADOR<br>{{contratista.nombre}} — CUIT {{contratista.cuit}}</td></tr></table>`,
  },
  {
    id: 'pl-locacion-servicios', tipo: 'locacion_servicios', nombre: 'Contrato de Locación de Servicios (por colaborador)',
    html: `<h2 style="text-align:center">CONTRATO DE LOCACIÓN DE SERVICIOS</h2>
<h4>1. Partes</h4>
<p>Entre {{contratista.nombre}} (en adelante, "EL CONTRATANTE"), CUIT N° {{contratista.cuit}}, inscripto en el Régimen PADIC, con domicilio en {{contratista.domicilio}}; y {{colaborador.nombre}} (en adelante, "EL LOCADOR"), CUIT N° {{colaborador.cuit}}, monotributista, con domicilio en {{colaborador.domicilio}}, se celebra el presente Contrato de Locación de Servicios, sujeto a las cláusulas que siguen.</p>
<h4>2. Objeto</h4>
<p>2.1. EL LOCADOR se obliga, por su cuenta y riesgo, a ejecutar los trabajos requeridos por EL CONTRATANTE para la correcta terminación de la obra. La prestación es de resultado, cumpliendo los estándares de calidad y las Normas IRAM aplicables. 2.2. La coordinación a cargo de EL CONTRATANTE se limita a verificar el resultado, sin facultades disciplinarias ni de dirección propias de la relación laboral.</p>
<h4>3. Carácter independiente</h4>
<p>3.1. El vínculo es estrictamente civil; queda fuera del alcance de los arts. 21 y 23 LCT. 3.2. EL LOCADOR organiza horarios, medios y herramientas con plena autonomía, asumiendo los riesgos de su actividad.</p>
<h4>4. Duración y alta en PADIC</h4>
<p>4.1. Plazo: {{plazo}}, contado desde {{fechaInicio}}, prorrogable por acuerdo escrito. 4.2. El contrato sólo entrará en vigor cuando EL LOCADOR acepte en el sistema PADIC el código de invitación dentro de las 72 h de generado.</p>
<h4>5. Honorarios y forma de pago</h4>
<p>5.1. EL CONTRATANTE abonará a EL LOCADOR la suma de {{colaborador.montoDia}} por día. 5.2. Los pagos se realizarán dentro de los 5 días hábiles de recibida la factura "C/B" válida y la constancia PADIC vigente. 5.3. Los honorarios incluyen tributos, seguros, viáticos, herramientas y cualquier gasto inherente a la prestación.</p>
<h4>6. Requisitos fiscales y de seguridad</h4>
<p>EL LOCADOR deberá mantener CUIT "Activo sin limitaciones", la condición de monotributista, y contar con Seguro de Accidentes Personales y ART vigentes que cubran las tareas comprometidas, presentando copia de las constancias antes de iniciar.</p>
<h4>7. Aceptación y bajas en PADIC</h4>
<p>Toda alta, baja o modificación se formalizará exclusivamente a través de la plataforma PADIC. La falta de aceptación dentro de 72 horas implicará la suspensión automática del presente contrato sin derecho a indemnización.</p>
<h4>8. Prevención de riesgos y responsabilidad</h4>
<p>EL LOCADOR declara conocer y cumplir las normas de seguridad aplicables (Ley 19.587 y Dec. 911/96) y mantendrá indemne a EL CONTRATANTE frente a cualquier reclamo de terceros o daños derivados de su actuación.</p>
<h4>9. Rescisión</h4>
<p>9.1. Cualquiera de las partes podrá rescindir sin causa con 5 días hábiles de preaviso escrito; sólo se abonarán los servicios efectivamente prestados. 9.2. Serán causa de rescisión inmediata: falta de aceptación/baja en PADIC, falta de seguro/ART vigente, incumplimiento grave de normas de seguridad o violación de la confidencialidad.</p>
<h4>10. Confidencialidad</h4>
<p>EL LOCADOR se obliga a guardar secreto sobre toda información técnica o comercial a la que acceda, durante la vigencia del contrato y por cinco (5) años posteriores.</p>
${CLAUSULA_PROP_SERV}
<h4>12. Jurisdicción</h4>
<p>Para cualquier controversia, las partes se someten a los Tribunales Ordinarios de la Ciudad de Necochea, provincia de Buenos Aires, con renuncia a cualquier otro fuero.</p>
<p style="margin-top:18px">En prueba de conformidad, se firman dos ejemplares de un mismo tenor en {{lugar}}, {{fecha}}.</p>
<table style="width:100%;margin-top:30px"><tr><td style="text-align:center">______________________<br>POR EL CONTRATANTE<br>{{contratista.nombre}} — CUIT {{contratista.cuit}}</td><td style="text-align:center">______________________<br>POR EL LOCADOR<br>{{colaborador.nombre}} — CUIT {{colaborador.cuit}}</td></tr></table>`,
  },
];

const cur = await get(KEY);
const arr = Array.isArray(cur.val) ? cur.val : [];
console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' (FORCE)' : ''} · plantillas actuales: ${arr.length} · a sembrar: ${PLANTILLAS.length}`);
PLANTILLAS.forEach(p => console.log(`  • ${p.nombre} (${p.tipo}) — ${p.html.length} chars`));
const yaEstan = PLANTILLAS.every(p => arr.some(x => x.id === p.id));
if (yaEstan && !FORCE) { console.log('Ya están todas (idempotente). Usá --force para re-sembrar.'); process.exit(0); }
if (!APPLY) { console.log('\\n*** DRY-RUN. --apply para sembrar (--force para pisar). ***'); process.exit(0); }

if (cur.row) writeFileSync(resolve(__dirname, `_backup_PRE_PLANTILLAS_CONTRATISTAS_${Date.now()}.json`), JSON.stringify(cur.val));
// merge: reemplaza por id las que existan, agrega las nuevas.
const byId = new Map(arr.map(p => [p.id, p]));
for (const p of PLANTILLAS) byId.set(p.id, p);
const nuevo = [...byId.values()];
if (cur.row) await supabase.from('shared_data').update({ [cur.col]: nuevo }).eq('key', KEY);
else await supabase.from('shared_data').insert({ key: KEY, data: nuevo });
console.log(`✅ Sembradas ${PLANTILLAS.length} plantillas en ${KEY}.`);
process.exit(0);
