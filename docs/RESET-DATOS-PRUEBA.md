# Reset de datos de prueba — arrancar el sistema limpio

Vacía **solo los datos que se cargan desde la app como usuario** (los 8 segmentos de
abajo) para empezar a usar el sistema en serio. Hace **backup primero** y es **reversible**.

> Se corre en **Supabase Studio → SQL Editor** (tu sesión, tu control — no requiere
> exponer ninguna credencial). Pegá los bloques **en orden**.

**Vacía:** obras · proveedores · clientes · movimientos+cajas · tareas · cheques ·
comprobantes (facturación) · gastos fijos.
**NO toca:** config de empresa, usuarios/logins, catálogo de costos, dólar, plantillas,
índices CAC, tokens del portal, datos de AFIP.

> ⚠️ Técnica: se **vacía el contenido** de cada fila (no se borra la fila). Si se borrara
> la fila, la app la re-siembra con datos demo en la próxima carga.

---

## 1) Backup (copia de seguridad dentro de la misma tabla)

Crea una copia de cada segmento con sufijo `_bkp_20260601` (inerte: la app no las lee).

```sql
insert into public.shared_data (key, data)
select key || '_bkp_20260601', data
from public.shared_data
where key in ('obras','proveedores','clientes','movimientos','tareas','cheques','comprobantes','gastos_fijos')
on conflict (key) do update set data = excluded.data;
```

## 2) Confirmar que el backup quedó (deben aparecer 8 filas)

```sql
select key from public.shared_data
where right(key, 13) = '_bkp_20260601'
order by key;
```

*(Opcional, backup en archivo: corré `select key, data from public.shared_data where key in (...los 8...)`
y usá **Download / Export → CSV** en la grilla de resultados.)*

## 3) Vaciar los 8 segmentos

```sql
update public.shared_data set data = '{"obras":[],"detalles":{}}'        where key = 'obras';
update public.shared_data set data = '{"proveedores":[],"ccEntries":[]}' where key = 'proveedores';
update public.shared_data set data = '[]'                                where key = 'clientes';
update public.shared_data set data = '{"cajas":[],"movimientos":[]}'     where key = 'movimientos';
update public.shared_data set data = '[]'                                where key = 'tareas';
update public.shared_data set data = '[]'                                where key = 'cheques';
update public.shared_data set data = '[]'                                where key = 'comprobantes';
update public.shared_data set data = '[]'                                where key = 'gastos_fijos';
```

## 4) Verificar que quedó vacío

```sql
select key, data from public.shared_data
where key in ('obras','proveedores','clientes','movimientos','tareas','cheques','comprobantes','gastos_fijos')
order by key;
```

## 5) Limpiar el cache local (IMPORTANTE)

En **cada dispositivo/navegador** donde uses la app: **cerrá sesión y volvé a entrar.**
Eso limpia el `localStorage` (cache de datos viejos) y recarga el estado vacío. Sin esto,
una pestaña abierta puede re-subir el cache viejo a la base.

---

## Restaurar (rollback, si te arrepentís)

```sql
update public.shared_data t set data = b.data
from public.shared_data b
where b.key = t.key || '_bkp_20260601'
  and t.key in ('obras','proveedores','clientes','movimientos','tareas','cheques','comprobantes','gastos_fijos');
```

## Borrar las copias de backup (cuando confirmes que está todo OK)

```sql
delete from public.shared_data where right(key, 13) = '_bkp_20260601';
```
