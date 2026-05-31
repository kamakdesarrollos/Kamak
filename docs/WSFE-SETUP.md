# WSFE — Emisión electrónica AFIP (factura con CAE)

Estado: **andamiaje**. El mapeo del comprobante a la estructura de AFIP está
hecho y testeado (`src/lib/wsfe.js`, `src/lib/wsfe.test.js`). Falta cablear la
conexión real, que **necesita el certificado digital de AFIP**. Probar SIEMPRE
primero en **homologación** (el entorno de pruebas de AFIP) antes de producción.

## Qué ya está hecho
- `src/lib/wsfe.js`: arma `FeCabReq` + `FeDetReq` (FECAESolicitar) desde un
  comprobante: tipo, punto de venta, doc del receptor (CUIT/DNI/CF), importes,
  array de IVA, condición IVA del receptor (RG 5616), concepto + período de
  servicio, y `CbtesAsoc` para notas de crédito/débito. + `buildLoginTicketRequest`.
- `api/afip/emitir.js`: endpoint. Hoy responde `501` con instrucciones hasta que
  se configure el certificado y se complete la firma.

## Qué falta (cuando tengas el certificado)

### 1. Generar el certificado en AFIP
1. Generar una clave privada y un CSR (pedido de certificado):
   ```bash
   openssl genrsa -out kamak.key 2048
   openssl req -new -key kamak.key -subj "/C=AR/O=Conquies Soluciones Constructivas SA/CN=kamak/serialNumber=CUIT 30717953858" -out kamak.csr
   ```
2. En AFIP (con clave fiscal): **Administración de Certificados Digitales** →
   subir el `.csr` → descargar el `.crt`.
3. **WSASS** (Administrador de Relaciones): vincular el certificado al servicio
   **wsfe** (Facturación Electrónica). En homologación: WSASS de homologación.

### 2. Cargar variables de entorno en Vercel
| Variable | Qué es |
|---|---|
| `AFIP_CUIT` | CUIT del emisor (Conquies) |
| `AFIP_CERT` | Contenido del `.crt` (PEM) |
| `AFIP_KEY`  | Contenido del `.key` (PEM, privada — NUNCA commitear) |
| `AFIP_ENV`  | `homologacion` (default) o `produccion` |

### 3. Completar `api/afip/emitir.js`
- **WSAA**: firmar el Login Ticket Request (de `buildLoginTicketRequest`) como
  CMS/PKCS#7 con el cert + key, mandarlo al WSAA y parsear `token` + `sign`.
  Node no tiene CMS de alto nivel built-in → usar `node-forge` o el SDK de AFIP.
  Cachear el TA (~12hs válido) en `shared_data` para no re-firmar en cada emisión.
- **WSFE**: con `token`/`sign`/`Cuit`:
  - `FECompUltimoAutorizado(PtoVta, CbteTipo)` → último número → `CbteDesde = +1`.
  - `FECAESolicitar(payload)` (de `feCaeSolicitarPayload`) → `CAE` + `CAEFchVto`.
- Guardar en el comprobante: `numero`, `cae`, `caeVto`, `estado: 'emitido'`.

### Endpoints AFIP
| | Homologación | Producción |
|---|---|---|
| WSAA | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | `https://wsaa.afip.gov.ar/ws/services/LoginCms` |
| WSFE | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

## Recomendación
Evaluar el paquete `@afipsdk/afip.js` (maneja WSAA + WSFE + firma) para no
implementar el CMS a mano. Si se prefiere sin dependencias externas, `node-forge`
cubre la firma PKCS#7 y el resto es SOAP sobre `fetch`.
