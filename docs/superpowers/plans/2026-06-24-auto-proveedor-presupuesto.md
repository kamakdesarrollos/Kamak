# Auto-resolución de proveedor desde el PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al adjuntar un presupuesto PDF, la app matchee el proveedor existente (CUIT/nombre flexible), o lo cree automáticamente con todos los datos de la factura (solo si hay CUIT) etiquetándolo con el rubro detectado por Claude.

**Architecture:** Lógica pura testeable en `src/lib/presupuestoImport.js` (`matchProveedorFlexible` + `resolverProveedorImport`). Claude (en `api/presupuesto/extraer.js`) devuelve un objeto `proveedor` con todos los datos. El modal prerellena/sugiere; `confirmarImport` (en `ObraPresupuesto.jsx`) decide link/crear/texto. Se agrega el campo `domicilio` al proveedor.

**Tech Stack:** React 19, Vite, Context API, Supabase, Anthropic API (Claude), vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-auto-proveedor-presupuesto-design.md`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/presupuestoImport.js` | Modificar | `matchProveedorFlexible` (CUIT exacto + nombre flexible) y `resolverProveedorImport` (decisión link/crear/texto). Puros. |
| `src/lib/presupuestoImport.test.js` | Modificar | Tests de los 2 helpers nuevos. |
| `api/presupuesto/extraer.js` | Modificar | Prompt + respuesta: objeto `proveedor` con todos los campos. |
| `src/pages/obra/AdjuntarPresupuestoModal.jsx` | Modificar | Nuevo shape, match flexible, prerelleno, `proveedorData` en onReady. |
| `src/pages/obra/ObraPresupuesto.jsx` | Modificar | `confirmarImport` usa `resolverProveedorImport` + crea con todos los datos. |
| `src/store/ProveedoresContext.jsx` | (sin cambio) | `addProveedor` ya fluye `data` arbitraria; `domicilio` pasa solo. |
| `src/pages/Proveedores.jsx` | Modificar | Campo `domicilio` en el form + mostrarlo en la tarjeta. |

---

## Task 1: `matchProveedorFlexible` (puro, TDD)

**Files:**
- Modify: `src/lib/presupuestoImport.js`
- Test: `src/lib/presupuestoImport.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `src/lib/presupuestoImport.test.js` (y a su import de arriba `matchProveedorFlexible, resolverProveedorImport`):

```js
describe('matchProveedorFlexible', () => {
  const provs = [
    { id: 'p1', nombre: 'Grupo Braf', cuit: '30-11111111-1' },
    { id: 'p2', nombre: 'Turbo Blender S.R.L.', cuit: '30-22222222-2' },
  ];
  it('CUIT exacto → match con exacto:true (auto-link)', () => {
    const r = matchProveedorFlexible('Cualquier Cosa', '30-22222222-2', provs);
    expect(r).toEqual({ proveedor: provs[1], exacto: true });
  });
  it('nombre con sufijo societario → match con exacto:false (sugerencia)', () => {
    // "Grupo Braf SA" sin CUIT debe sugerir "Grupo Braf"
    const r = matchProveedorFlexible('Grupo Braf SA', null, provs);
    expect(r.proveedor.id).toBe('p1');
    expect(r.exacto).toBe(false);
  });
  it('contención de nombre → sugiere', () => {
    const r = matchProveedorFlexible('Turbo Blender', null, provs);
    expect(r.proveedor.id).toBe('p2');
    expect(r.exacto).toBe(false);
  });
  it('sin match → null', () => {
    expect(matchProveedorFlexible('Otra Empresa', null, provs)).toBeNull();
  });
  it('nombre muy corto no genera falso positivo por contención', () => {
    expect(matchProveedorFlexible('SA', null, provs)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/lib/presupuestoImport.test.js`
Expected: FAIL (`matchProveedorFlexible is not a function`).

- [ ] **Step 3: Implementar** (agregar en `src/lib/presupuestoImport.js`, después de `matchProveedor`)

```js
// Clave normalizada de un nombre de empresa: minúsculas, sin acentos/puntuación y
// sin sufijos societarios (SA/SRL/SAS/SACI…), para comparar "Grupo Braf" ≈ "Grupo Braf SA".
function nombreClave(s) {
  let n = norm(s).replace(/[.\-,]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/\b(sa|sac|saci|sacif|saic|srl|sas|sci|scs|sce)\b/g, '').replace(/\s+/g, ' ').trim();
  return n;
}

// Match flexible para resolver el proveedor de un presupuesto.
// - CUIT exacto → { proveedor, exacto: true }  (apto para auto-link)
// - nombre (igualdad de clave o contención ≥4) → { proveedor, exacto: false } (sugerencia editable)
// - nada → null
export function matchProveedorFlexible(nombre, cuit, proveedores) {
  const list = proveedores || [];
  const c = (cuit || '').replace(/[^\dkK]/g, '');
  if (c) {
    const porCuit = list.find(p => (p.cuit || '').replace(/[^\dkK]/g, '') === c);
    if (porCuit) return { proveedor: porCuit, exacto: true };
  }
  const n = nombreClave(nombre);
  if (!n) return null;
  let p = list.find(x => nombreClave(x.nombre) === n);
  if (p) return { proveedor: p, exacto: false };
  p = list.find(x => {
    const xn = nombreClave(x.nombre);
    return xn && n.length >= 4 && xn.length >= 4 && (xn.includes(n) || n.includes(xn));
  });
  return p ? { proveedor: p, exacto: false } : null;
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/lib/presupuestoImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presupuestoImport.js src/lib/presupuestoImport.test.js
git commit -m "feat(presupuesto-import): matchProveedorFlexible (CUIT exacto + nombre flexible)"
```

---

## Task 2: `resolverProveedorImport` (puro, TDD)

**Files:**
- Modify: `src/lib/presupuestoImport.js`
- Test: `src/lib/presupuestoImport.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('resolverProveedorImport', () => {
  const pd = { razonSocial: 'ACME SA', cuit: '30-99999999-9', domicilio: 'Calle 1', telefono: '11-1234', email: 'a@acme.com', condicionIVA: 'Responsable Inscripto', rubro: 'Equipamiento gastronómico' };
  it('si hay proveedorId elegido → link', () => {
    expect(resolverProveedorImport(pd, 'p7')).toEqual({ accion: 'link', proveedorId: 'p7' });
  });
  it('sin id pero con CUIT → crear con todos los datos', () => {
    expect(resolverProveedorImport(pd, null)).toEqual({
      accion: 'crear',
      datos: {
        nombre: 'ACME SA', cuit: '30-99999999-9', domicilio: 'Calle 1',
        telefono: '11-1234', email: 'a@acme.com', condicion: 'Responsable Inscripto',
        tipo: 'Equipamiento gastronómico', categoria: 'Mano de obra',
      },
    });
  });
  it('sin id y sin CUIT → texto libre (no crea)', () => {
    expect(resolverProveedorImport({ razonSocial: 'Sin Cuit' }, null)).toEqual({ accion: 'texto', nombre: 'Sin Cuit' });
  });
  it('condicionIVA ausente → default Responsable Inscripto', () => {
    const r = resolverProveedorImport({ razonSocial: 'X', cuit: '20-1-2' }, null);
    expect(r.datos.condicion).toBe('Responsable Inscripto');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/lib/presupuestoImport.test.js`
Expected: FAIL (`resolverProveedorImport is not a function`).

- [ ] **Step 3: Implementar** (en `src/lib/presupuestoImport.js`)

```js
// Decide qué hacer con el proveedor de un presupuesto importado.
// proveedorData = { razonSocial, cuit, domicilio, telefono, email, condicionIVA, rubro }
// proveedorId = id ya resuelto (match exacto o elegido por el usuario) o null.
// → { accion:'link', proveedorId } | { accion:'crear', datos } | { accion:'texto', nombre }
export function resolverProveedorImport(proveedorData, proveedorId) {
  const d = proveedorData || {};
  if (proveedorId) return { accion: 'link', proveedorId };
  const cuit = (d.cuit || '').toString().trim();
  if (cuit) {
    return { accion: 'crear', datos: {
      nombre: d.razonSocial || 'Proveedor',
      cuit,
      domicilio: d.domicilio || '',
      telefono: d.telefono || '',
      email: d.email || '',
      condicion: d.condicionIVA || 'Responsable Inscripto',
      tipo: d.rubro || '',
      categoria: 'Mano de obra',
    } };
  }
  return { accion: 'texto', nombre: d.razonSocial || '' };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/lib/presupuestoImport.test.js`
Expected: PASS (toda la suite del módulo en verde).

- [ ] **Step 5: Commit**

```bash
git add src/lib/presupuestoImport.js src/lib/presupuestoImport.test.js
git commit -m "feat(presupuesto-import): resolverProveedorImport (link/crear/texto)"
```

---

## Task 3: Endpoint — extraer datos del proveedor

**Files:**
- Modify: `api/presupuesto/extraer.js`

- [ ] **Step 1: Cambiar el PROMPT** (reemplazar la constante `PROMPT`)

```js
const PROMPT = `Sos un extractor de presupuestos de obra. Te paso un presupuesto de un proveedor/subcontratista.
Devolvé SOLO un JSON con esta forma exacta, sin texto adicional:
{"proveedor": {"razonSocial": "<nombre/razón social o null>", "cuit": "<cuit o null>", "domicilio": "<dirección completa o null>", "telefono": "<o null>", "email": "<o null>", "condicionIVA": "<Responsable Inscripto/Monotributo/Exento o null>", "rubro": "<rubro o especialidad del proveedor inferida del presupuesto, o null>"}, "items": [{"nombre": "<descripción del ítem>", "costo": <número, precio UNITARIO sin símbolos>, "cantidad": <número, 1 si no figura>, "unidad": "<u/m2/ml/gl/etc o 'u'>"}]}
El "costo" es siempre el precio unitario del ítem (si solo hay total de línea, poné cantidad 1 y el total como costo). No inventes datos que no estén: si un dato del proveedor no figura, poné null.`;
```

- [ ] **Step 2: Cambiar la respuesta** (reemplazar el `return res.status(200).json({...})` del try)

```js
    const data = JSON.parse(text.slice(start, end + 1));
    const prov = data.proveedor || {};
    return res.status(200).json({
      proveedor: {
        razonSocial: prov.razonSocial || null,
        cuit: prov.cuit || null,
        domicilio: prov.domicilio || null,
        telefono: prov.telefono || null,
        email: prov.email || null,
        condicionIVA: prov.condicionIVA || null,
        rubro: prov.rubro || null,
      },
      items: Array.isArray(data.items) ? data.items : [],
    });
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check api/presupuesto/extraer.js`
Expected: sin output (OK).

- [ ] **Step 4: Commit**

```bash
git add api/presupuesto/extraer.js
git commit -m "feat(api): extraer datos del proveedor (cuit/domicilio/tel/email/condIVA/rubro) del presupuesto"
```

---

## Task 4: Campo `domicilio` en el proveedor

**Files:**
- Modify: `src/pages/Proveedores.jsx`

- [ ] **Step 1: Agregar `domicilio` al estado inicial del form**

En `src/pages/Proveedores.jsx`, en el objeto inicial del form (la línea con `{ nombre: '', categoria: 'Mano de obra', tipo: '', cuit: '', telefono: '', email: '', condicion: 'Responsable Inscripto', cbu: '', alias: '', calificacion: 0, grupos: [], notas: '' }`), agregar `domicilio: ''`:

```js
: { nombre: '', categoria: 'Mano de obra', tipo: '', cuit: '', domicilio: '', telefono: '', email: '', condicion: 'Responsable Inscripto', cbu: '', alias: '', calificacion: 0, grupos: [], notas: '' });
```

- [ ] **Step 2: Agregar el input Domicilio en el form**

Justo después del input de CUIT (el `<input ... value={form.cuit} ... placeholder="20-12345678-9" />`), agregar:

```jsx
<label style={labelSt}>Domicilio
  <input style={inputSt} value={form.domicilio || ''} onChange={e => set('domicilio', e.target.value)} placeholder="Calle 123, Localidad" />
</label>
```

(Si el patrón de los otros campos no usa `<label style={labelSt}>`, replicar EXACTAMENTE el envoltorio que usa el input de CUIT contiguo, cambiando label→"Domicilio", value→`form.domicilio`, onChange→`set('domicilio', …)`.)

- [ ] **Step 3: Mostrar el domicilio en la tarjeta del proveedor**

En el bloque donde se muestran tel/email de la tarjeta (busca `p.telefono` / `p.email` en el render de la card), agregar, condicionado a `p.domicilio`:

```jsx
{p.domicilio && <div style={{ fontSize: 11, color: T.ink3 }}>📍 {p.domicilio}</div>}
```

(Ubicarlo junto a las líneas de teléfono/email existentes, con el estilo de esa zona.)

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: `built in ...` sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Proveedores.jsx
git commit -m "feat(proveedores): campo domicilio (form + tarjeta)"
```

---

## Task 5: Modal — nuevo shape + match flexible + prerelleno

**Files:**
- Modify: `src/pages/obra/AdjuntarPresupuestoModal.jsx`

- [ ] **Step 1: Cambiar el import de helpers**

```js
import { detectarColumnas, indiceHeader, matchProveedorFlexible } from '../../lib/presupuestoImport';
```

- [ ] **Step 2: Reemplazar el branch PDF (la parte `else { … }` de `leer`)**

```js
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const fileBase64 = await toBase64(file);
        const r = await fetch('/api/presupuesto/extraer', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ fileBase64, mediaType: file.type || 'application/pdf' }),
        });
        if (!r.ok) throw new Error('No se pudo leer el PDF');
        const { proveedor: pd, items } = await r.json();
        const detectado = pd || {};
        // Match flexible: CUIT exacto = auto-link; nombre = sugerencia editable.
        const m = matchProveedorFlexible(detectado.razonSocial, detectado.cuit, proveedores);
        const nombreSugerido = provNombre || m?.proveedor?.nombre || detectado.razonSocial || '';
        onReady({
          items, columnas: null, file,
          proveedorNombre: nombreSugerido,
          proveedorId: m?.exacto ? m.proveedor.id : null, // solo auto-link por CUIT
          proveedorData: detectado, // razonSocial, cuit, domicilio, tel, email, condIVA, rubro
        });
      }
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/obra/AdjuntarPresupuestoModal.jsx
git commit -m "feat(presupuesto): el modal lee los datos del proveedor y sugiere match flexible"
```

---

## Task 6: `confirmarImport` — link/crear con todos los datos

**Files:**
- Modify: `src/pages/obra/ObraPresupuesto.jsx`

- [ ] **Step 1: Agregar `matchProveedorFlexible, resolverProveedorImport` al import de presupuestoImport**

Buscar el import existente `import { itemsATareas, montoContrato, ... } from '../../lib/presupuestoImport';` y agregar `matchProveedorFlexible, resolverProveedorImport`.

- [ ] **Step 2: Reemplazar la resolución del proveedor dentro de `confirmarImport`**

Reemplazar el bloque actual (desde `const proveedorNombre = ...` hasta antes de `const adjuntoId = newId();`, incluyendo el `addProveedor` condicional viejo y la subida) por:

```js
    const proveedorData = adjReady.proveedorData || {};
    const proveedorNombre = adjReady.proveedorNombre || proveedorData.razonSocial || 'Proveedor';
    // Subir PRIMERO (bucket privado): si falla, no creamos nada. El error lo muestra el modal.
    const { path, bucket } = await subirAdjuntoPrivado(adjReady.file, `presupuestos/${obra.id}`);
    // Resolver el id: el del match exacto (CUIT) o, si el nombre tipeado coincide con
    // uno existente, ese; si no, null.
    let proveedorId = adjReady.proveedorId || null;
    if (!proveedorId && proveedorNombre) {
      const m = matchProveedorFlexible(proveedorNombre, proveedorData.cuit, provListPresu);
      if (m) proveedorId = m.proveedor.id;
    }
    // Decidir: link | crear (solo si hay CUIT) | texto libre.
    const decision = resolverProveedorImport(proveedorData, proveedorId);
    let proveedorFinalId = null;
    let proveedorFinalNombre = proveedorNombre;
    if (decision.accion === 'link') {
      proveedorFinalId = decision.proveedorId;
      const ex = provListPresu.find(p => p.id === proveedorFinalId);
      if (ex) proveedorFinalNombre = ex.nombre;
    } else if (decision.accion === 'crear') {
      proveedorFinalId = addProveedor(decision.datos);
      proveedorFinalNombre = decision.datos.nombre;
    } else {
      proveedorFinalNombre = decision.nombre || proveedorNombre;
    }
```

Y en la construcción de `adjunto` y `contrato`, usar `proveedorFinalId` / `proveedorFinalNombre` en lugar de `proveedorId` / `proveedorNombre`:

```js
    const adjuntoId = newId();
    const adjunto = { id: adjuntoId, nombre: adjReady.file.name, path, bucket, fecha: new Date().toISOString(), proveedor: proveedorFinalNombre, proveedorId: proveedorFinalId, contratoId };
    const rubro = detalle.rubros.find(r => r.id === adjRubroId);
    const contrato = {
      id: contratoId, gremio: rubro?.nombre || '', proveedor: proveedorFinalNombre, proveedorId: proveedorFinalId,
      monto: montoContrato(contratoId, tareas), estado: 'borrador', origen: 'adjunto',
      adjuntoId, rubroId: adjRubroId, fondoReparo: 5,
    };
```

- [ ] **Step 3: Verificar build + tests**

Run: `npm run build && npx vitest run`
Expected: build OK, suite en verde.

- [ ] **Step 4: Commit**

```bash
git add src/pages/obra/ObraPresupuesto.jsx
git commit -m "feat(presupuesto): confirmarImport crea/linkea proveedor con todos los datos (resolverProveedorImport)"
```

> **Verificación manual (post-deploy):** subir un PDF cuyo proveedor (con CUIT) NO exista → al importar, debe aparecer ese proveedor en la sección Proveedores con CUIT/domicilio/tel/email/condición y `tipo`=rubro detectado. Subir un PDF de un proveedor existente (mismo CUIT) → debe linkear sin duplicar. Subir uno sin CUIT y sin match → el contrato queda con el nombre como texto y NO se crea proveedor.

---

## Deploy / cierre

- [ ] Merge a `main` + push (mismo flujo que la feature base: el usuario corre `git push origin main`).
- [ ] La feature NO requiere migración nueva (reusa el bucket privado `kamak-presupuestos` ya creado).
- [ ] Verificación e2e con los 3 casos de la nota de Task 6.

---

## Self-Review

- **Cobertura del spec:** extracción (Task 3) ✓ · match flexible (Task 1) ✓ · crear-solo-con-CUIT + rubro + todos los datos (Task 2 + Task 6) ✓ · campo domicilio (Task 4) ✓ · prerelleno/sugerencia en modal (Task 5) ✓ · aviso informativo en modal → **pendiente menor**, se puede sumar en Task 5 si se quiere (no bloqueante; el spec lo marca como informativo).
- **Placeholders:** ninguno; todo el código está escrito.
- **Consistencia de tipos:** `proveedorData` = { razonSocial, cuit, domicilio, telefono, email, condicionIVA, rubro } usado igual en Task 3 (salida), Task 5 (onReady) y Task 2/6 (consumo). `resolverProveedorImport(proveedorData, proveedorId)` y `matchProveedorFlexible(nombre, cuit, proveedores)` con las mismas firmas en todas las tareas.
