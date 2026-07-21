# Flujo de trabajo — Kamak ERP

> Objetivo: que cada uno pueda modificar y deployar **sin depender del otro**,
> pero que **nadie pueda romper producción sin querer** — sobre todo la plata.
> El que dice "sí/no" es el sistema (los tests), no una persona.

## La idea en una frase

**El código se prueba aparte (preview + base de staging). Si los tests pasan, va
a `main` y sale a producción solo. Si algo se coló, se revierte en 1 clic.**

## El pipeline

```
Rama (fix/dinero-x)
   │  push a GitHub
   ▼
Preview de Vercel (URL propia)  +  base de STAGING (Supabase kamak-staging)
   │  probás acá, contra datos de mentira · corren los tests
   ▼
Pull Request → GitHub
   │  el CI corre tests + build. Si fallan, NO se puede mergear.
   ▼  (0 aprobaciones necesarias — te automergeás vos)
main  →  Vercel deploya el código a producción  (base real)
        + si el PR traía migraciones, se aplican solas a la base real
```

- **Preview = aísla el código.** Cada rama/PR tiene su URL propia en Vercel.
- **Staging = aísla los datos.** Los previews pegan contra la base `kamak-staging`,
  nunca contra la real. Probar facturación en preview NO toca plata de verdad.
- **CI = el candado.** Tests y build tienen que pasar sí o sí. Es automático.

## Reglas

1. **Nunca se trabaja directo sobre `main`.** Siempre una rama: `fix/...` o `feat/...`.
2. **Todo entra por Pull Request.** Aunque sea un cambio chico. El PR es lo que dispara
   el CI. No hace falta que nadie apruebe: si el CI está verde, te lo mergeás vos.
3. **Si el CI está rojo, no se mergea.** El botón queda bloqueado (para todos).
4. **Producción se revierte en 1 clic.** Si algo se coló: Vercel → Deployments →
   deploy anterior → "Promote to Production" (rollback instantáneo).
   > Ojo: el rollback revierte el *código*, no la base. Una migración ya aplicada
   > sigue aplicada — por eso las migraciones se prueban antes en staging.

## Migraciones de base de datos (el punto delicado)

Los cambios de plata suelen traer un `.sql` nuevo en `supabase/migrations/`.
Una migración le cambia el schema a producción para **todos, al instante**.

**Ahora se aplican solas**: al mergear a `main`, si el PR tocó `supabase/migrations/`,
la Action `DB Migrate (producción)` corre `supabase db push` contra la base real.
Ya no depende de que alguien se acuerde. Si falla, el job queda en rojo y llega aviso.

Igual, el orden de trabajo sigue siendo:

1. Escribir el `.sql` en `supabase/migrations/`.
2. Aplicarlo **primero a staging** (`supabase db push` apuntando a kamak-staging).
3. Probar en el preview que todo anda.
4. Abrir el PR y mergear → la migración se aplica sola a prod.

> **Regla de oro: migraciones compatibles hacia atrás (expand/contract).**
> El código nuevo y la migración se deployan casi al mismo tiempo, en paralelo.
> Si una migración *rompe* el schema que el código viejo todavía está usando
> (ej. borrar/renombrar una columna), puede haber unos segundos de errores.
> Por eso: primero **agregar** (columna/tabla nueva), migrar los datos, y recién
> en un deploy posterior **sacar** lo viejo. Nunca las dos cosas en el mismo paso.

## Bases y entornos

| Entorno               | Dónde corre | Contra qué base   |
|-----------------------|-------------|-------------------|
| `npm run dev` (local) | tu máquina  | kamak-staging     |
| Preview (rama/PR)     | Vercel      | kamak-staging     |
| Producción (`main`)   | Vercel      | Supabase real     |

El ruteo se hace con las variables de entorno scopeadas por entorno en Vercel
(Preview → staging, Production → real): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

## Setup inicial (una sola vez)

1. **Base de staging**: crear proyecto `kamak-staging` en Supabase, aplicarle todas las
   migraciones (`supabase db push`), la Edge Function `admin-users`, RLS y los buckets
   de storage. Cargar 2-3 obras/clientes ficticios.
2. **Vercel**: en el proyecto `kamak1324` → Settings → Environment Variables, poner las
   4 variables de arriba scopeadas a **Preview** con los datos de staging (dejando
   **Production** con los reales).
3. **Secrets de GitHub** (para la Action de migraciones): `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (ver `.github/workflows/db-migrate.yml`).
4. **Protección de `main`**: PR obligatorio, check `verify` obligatorio, 0 aprobaciones,
   alcanza a admins. (Ya configurada vía la API de GitHub.)
