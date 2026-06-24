# Auto-resolución de proveedor desde el PDF del presupuesto — Design

> Estado: aprobado (brainstorming 2026-06-24). Continúa la feature [adjuntar presupuesto de tercero].

## Problema

Al adjuntar un presupuesto de tercero por **PDF/imagen**, hoy se extraen los ítems con Claude
y se resuelve el proveedor solo por CUIT/nombre exacto; si no matchea, se crea un proveedor
mínimo (solo nombre+CUIT) y nada más. El usuario quiere que:

1. Si el proveedor del PDF matchea uno existente → se asigne automáticamente.
2. Si no matchea y la factura trae CUIT → se cree el proveedor en la sección **Proveedores**
   con **todos** los datos de la factura (CUIT, domicilio, teléfono, email, condición IVA).
3. Se **detecte el rubro** del presupuesto y se etiquete al proveedor con ese rubro.

## Decisiones (brainstorming)

- **Crear proveedor: solo si hay CUIT.** Con CUIT detectado y sin match → crear automático. Sin
  CUIT → usar el nombre como texto libre en el contrato, **no** crear (evita basura de OCR).
- **Dirección:** se agrega un campo nuevo `domicilio` al modelo de proveedor (string con la
  dirección completa). Cambio retrocompatible.
- **Rubro del proveedor:** lo **detecta Claude** del contenido del PDF → va a `proveedor.tipo`.
- **Match:** CUIT exacto → linkea automático. Sin CUIT-match → match por nombre **flexible**
  (normaliza + saca sufijos societarios + contención) → preselecciona en el modal, editable.

## Arquitectura

### 1. Extracción — `api/presupuesto/extraer.js`
El prompt de Claude se extiende para devolver un objeto `proveedor` además de `items`:

```json
{
  "proveedor": {
    "razonSocial": "<o null>", "cuit": "<o null>", "domicilio": "<o null>",
    "telefono": "<o null>", "email": "<o null>", "condicionIVA": "<o null>",
    "rubro": "<rubro/especialidad inferida del presupuesto, o null>"
  },
  "items": [ { "nombre", "costo", "cantidad", "unidad" } ]
}
```

La respuesta del endpoint pasa a `{ proveedor: {...}, items: [...] }` (antes `{ proveedor, cuit, items }`).
El cliente (`AdjuntarPresupuestoModal`) se adapta al nuevo shape.

### 2. Match — `src/lib/presupuestoImport.js` (puro, TDD)
- `matchProveedor(nombre, cuit, proveedores)` se mantiene para el **CUIT exacto** y nombre idéntico.
- Nuevo `matchProveedorFlexible(nombre, cuit, proveedores)`:
  1. Si hay CUIT → match exacto por CUIT (igual que hoy).
  2. Si no → normaliza nombres (lower + sin acentos + sin sufijos `sa|s.a.|srl|s.r.l.|sas|saci|sa de cv`),
     y matchea por **igualdad o contención** de tokens. Devuelve `{ proveedor, exacto: bool }`
     donde `exacto=true` solo para el CUIT (auto-link); `exacto=false` = sugerencia editable.

### 3. Creación / link — `confirmarImport` en `ObraPresupuesto.jsx`
Reglas al confirmar (path PDF, datos en `adjReady.proveedorData`):
- Matcheó existente (CUIT o el usuario aceptó la sugerencia) → usar su `id`.
- No matcheó **y hay CUIT** → `addProveedor` con todos los campos:
  `{ nombre: razonSocial, cuit, domicilio, telefono, email, condicion: condicionIVA||'Responsable Inscripto',
     tipo: rubro, categoria: 'Mano de obra' }` y usar el `id` devuelto.
- No matcheó y **sin CUIT** → `proveedorId: null`, el contrato/adjunto guardan solo el nombre como texto.

### 4. Modelo de proveedor — `src/store/ProveedoresContext.jsx` + `src/pages/Proveedores.jsx`
- `addProveedor`/shape: el campo `domicilio` simplemente fluye en `data` (no hace falta tocar el
  reducer; sí asegurar que el form lo incluya).
- Form de Proveedores: nuevo input **Domicilio** (estado inicial `domicilio: ''`).
- Tarjeta de proveedor: muestra el domicilio si existe (junto a tel/email).

### 5. UI — `AdjuntarPresupuestoModal.jsx`
- Tras leer el PDF, prerellena el campo "Proveedor" con el match flexible (o la razón social detectada).
- Entrega en `onReady` un `proveedorData` con todos los campos detectados + `proveedorId` (si matcheó exacto).
- Aviso informativo (no bloqueante) cuando se va a crear: *"➕ Se creará el proveedor «X» (CUIT …)"*.

## Flujo de datos

```
PDF → extraer.js (Claude) → { proveedor:{razonSocial,cuit,domicilio,tel,email,condIVA,rubro}, items }
  → AdjuntarPresupuestoModal: matchProveedorFlexible → prerellena campo proveedor + arma proveedorData
  → RevisarPresupuestoModal (ítems, sin cambios)
  → confirmarImport: link existente | crear-con-CUIT | texto-libre-sin-CUIT
       → addProveedor (si crea) → contrato/adjunto con proveedorId + proveedorNombre
```

## Testing (TDD)

- `matchProveedorFlexible`: CUIT exacto; nombre con sufijo societario ("Grupo Braf" ≈ "Grupo Braf SA");
  contención; sin match → null; flag `exacto`.
- Lógica link-vs-crear-vs-texto-libre (extraída a un helper puro `resolverProveedorImport(proveedorData, match)`
  que devuelve la decisión `{ accion: 'link'|'crear'|'texto', proveedor?|datosNuevos? }`, testeable sin React).

## Alcance / no-incluye

- Solo el path **PDF/imagen** (Claude). El Excel no extrae datos de proveedor.
- No se crea proveedor sin CUIT (decisión explícita).
- No se toca la matemática de venta/contrato (ya cubierta por la feature base).
- `domicilio` es un único string (no se desglosa en calle/localidad/CP).
