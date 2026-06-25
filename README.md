# lex-control-api (`@lex/db`)

Backend de **LEX Control**: capa de datos Prisma (MySQL) + API HTTP Express. Expone el
cliente Prisma singleton y la API REST que consumen el panel admin (`:3000`) y el
portal cliente (`:3001`). Corre en **`:4000`**.

- **Stack:** Node 22, TypeScript, Express, Prisma 6 + MySQL (base `LEX`).
- **Datos:** la BD se sincroniza con `pnpm push` (sin migraciones). `schema.prisma` es
  la fuente de verdad; tras tocarlo, `pnpm generate`.

> ⚠️ **No corras `pnpm migrate` contra la BD real**: `prisma migrate dev` la **resetea**
> (pérdida de datos). Usá `pnpm push`.

## Scripts

| Script | Qué hace |
|--------|----------|
| `pnpm dev` | Servidor en watch (tsx), puerto `PORT` (4000) |
| `pnpm build` / `pnpm start` | Compila a `dist/` y lo ejecuta |
| `pnpm test` | Tests de integración (vitest + supertest) |
| `pnpm generate` | Regenera el cliente Prisma |
| `pnpm push` | Sincroniza esquema con la BD (sin migraciones) |
| `pnpm seed` | Siembra el catálogo de servicios |
| `pnpm seed:admin` | Crea/actualiza el ADMIN (requiere `ADMIN_EMAIL`/`ADMIN_PASSWORD`) |
| `pnpm studio` | Explorador visual de la BD (Prisma Studio) |

## Entorno

`lex-control-api/.env` (nunca se commitea): `DATABASE_URL`, `JWT_SECRET` (requerido),
`PORT`, `CORS_ORIGINS`. Ver el bloque completo en el **README raíz**.

---

Setup completo, variables de entorno y cómo levantar toda la plataforma: ver el
[README del repo paraguas](../README.md).
