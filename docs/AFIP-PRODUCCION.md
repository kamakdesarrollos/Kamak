# Pasaje de AFIP a PRODUCCIÓN (facturas reales)

> Estado actual: **homologación operativa** (emite CAE de prueba). El código ya está
> deployado y endurecido (auth en el endpoint, idempotencia + libro de CAE, QR RG 4892,
> factura imprimible). Este runbook es el cutover a producción real.
>
> Reparto: 🧑 = lo hace el usuario en AFIP/Supabase · 🤖 = lo hace Claude con el CLI ya
> linkeado a `kamak1324` (`app.kamak.com.ar`). Ver `docs/WSFE-SETUP.md` para el detalle
> de la mecánica del certificado.

---

## 1. 🧑 Certificado de PRODUCCIÓN + delegación (AFIP, con clave fiscal)

1. Generar la clave privada y el CSR (si reusás el de homologación, saltear):
   ```bash
   openssl genrsa -out conquies-prod.key 2048
   openssl req -new -key conquies-prod.key \
     -subj "/C=AR/O=Conquies Soluciones Constructivas SA/CN=kamak/serialNumber=CUIT 30717953858" \
     -out conquies-prod.csr
   ```
2. AFIP (clave fiscal) → **Administración de Certificados Digitales** (entorno de
   **producción**) → subir el `.csr` → descargar el `.crt` (`conquies-prod.crt`).
3. **WSASS** de producción (Administrador de Relaciones) → vincular el certificado al
   servicio **wsfe** (Facturación Electrónica). Si el cert es de Franco emitiendo por
   Conquies, configurar la **delegación** para que el alias pueda facturar en nombre de
   Conquies (CUIT 30-71795385-8).

## 2. 🧑 Punto de venta de PRODUCCIÓN (AFIP)

1. AFIP → **Administración de puntos de venta y domicilios** → la empresa Conquies →
   **A/B/M de puntos de venta** → **Agregar**.
2. En **Sistema** elegir **"RECE para aplicativo y web service"** (NO "Comprobantes en
   línea" — WSFE lo rechaza). Asociar el domicilio fiscal.
3. Anotar el número de PV (lo cargamos en la app, paso 5).

## 3. 🤖 Cargar el certificado de prod en Vercel + flip de entorno

> Pasame `conquies-prod.crt`, `conquies-prod.key` y confirmá el CUIT/PV; el resto lo corro yo.
> Los PEM se guardan en **base64 de una línea** (`normalizePem` los decodifica). En PowerShell:
>
> ```powershell
> [Convert]::ToBase64String([IO.File]::ReadAllBytes("conquies-prod.crt"))  # → valor de AFIP_CERT
> [Convert]::ToBase64String([IO.File]::ReadAllBytes("conquies-prod.key"))  # → valor de AFIP_KEY
> ```

Comandos (el repo ya está linkeado a `kamak1324`):

```bash
# Reemplazar el valor en producción (rm + add; add lee el valor por stdin)
vercel env rm  AFIP_CERT production --yes;  printf '%s' "<BASE64_CRT>" | vercel env add AFIP_CERT production
vercel env rm  AFIP_KEY  production --yes;  printf '%s' "<BASE64_KEY>" | vercel env add AFIP_KEY  production
vercel env rm  AFIP_CUIT production --yes;  printf '%s' "30717953858"  | vercel env add AFIP_CUIT production
vercel env rm  AFIP_ENV  production --yes;  printf '%s' "produccion"    | vercel env add AFIP_ENV  production

# Las env vars solo aplican en un nuevo deploy:
vercel --prod
```

> ⚠️ El cache del Ticket de Acceso está separado por entorno (`afip_ta_produccion`), así
> que el flip no reusa el TA de homologación. Primera emisión en prod pide TA nuevo.

## 4. 🧑/🤖 Punto de venta en la app

Configuración → Datos de empresa → **Punto de venta AFIP** = el número del paso 2.
(También puedo setearlo yo vía `shared_data` si preferís.)

## 5. 🧑 RLS de Supabase (cierra el token de AFIP al cliente)

Supabase Studio → SQL Editor → pegar y **Run** (idempotente). Es la **sección 2** de
`supabase/migrations/0001_rls.sql` — cierra el acceso del cliente a `afip_*`
(Ticket de Acceso + libro de emisión):

```sql
alter table public.shared_data enable row level security;

drop policy if exists "shared_data_select_operativas" on public.shared_data;
drop policy if exists "shared_data_insert_operativas" on public.shared_data;
drop policy if exists "shared_data_update_operativas" on public.shared_data;
drop policy if exists "shared_data_select_admin_keys" on public.shared_data;
drop policy if exists "shared_data_insert_admin_keys" on public.shared_data;
drop policy if exists "shared_data_update_admin_keys" on public.shared_data;

create policy "shared_data_select_operativas"
  on public.shared_data for select to authenticated using (key <> 'portal_tokens' and key !~ '^afip_');
create policy "shared_data_insert_operativas"
  on public.shared_data for insert to authenticated with check (key <> 'portal_tokens' and key !~ '^afip_');
create policy "shared_data_update_operativas"
  on public.shared_data for update to authenticated using (key <> 'portal_tokens' and key !~ '^afip_') with check (key <> 'portal_tokens' and key !~ '^afip_');

create policy "shared_data_select_admin_keys"
  on public.shared_data for select to authenticated using (key = 'portal_tokens' and public.is_admin());
create policy "shared_data_insert_admin_keys"
  on public.shared_data for insert to authenticated with check (key = 'portal_tokens' and public.is_admin());
create policy "shared_data_update_admin_keys"
  on public.shared_data for update to authenticated using (key = 'portal_tokens' and public.is_admin()) with check (key = 'portal_tokens' and public.is_admin());
```

Verificación (como usuario NO admin, desde la app/DevTools):
`select * from shared_data where key like 'afip_%';` → **0 filas**.

## 6. 🤖 Verificación post-cutover

```bash
curl -s https://app.kamak.com.ar/api/afip/emitir          # → {"ok":true,"configurado":true,"env":"produccion"}
```
Después, en la app: crear un borrador real → **AFIP** → debe dar **CAE de producción** →
**🖨** para la factura con CAE + QR. ⚠️ Eso ya es una **factura fiscal real**.

---

### Checklist
- [ ] 🧑 Cert prod Conquies + delegación WSASS a `wsfe`
- [ ] 🧑 Punto de venta de producción (Web Services)
- [ ] 🤖 `AFIP_CERT`/`AFIP_KEY`/`AFIP_CUIT` prod + `AFIP_ENV=produccion` + redeploy
- [ ] Punto de venta cargado en Configuración
- [ ] 🧑 RLS sección 2 corrida en Supabase
- [ ] 🤖 `GET /api/afip/emitir` → `env:produccion` + emisión real de prueba
