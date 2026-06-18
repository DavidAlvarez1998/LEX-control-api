# Migraciones de base de datos

La DB de **producción/compartida** (`LEX` en `DEMO-ROUTER`) se gestiona con **Prisma Migrate**
desde el baseline `0_init` (junio 2026). Antes se usaba solo `prisma db push` (sin historial).

## ⛔ Regla de oro
**NUNCA** corras `prisma migrate dev` (`pnpm migrate`) contra la DB compartida/producción.
`migrate dev` **resetea la base de datos** (DROP + recrea) si detecta cualquier drift → **pérdida de datos**.
Úsalo solo contra una DB **local desechable**.

## Flujos

### Aplicar migraciones existentes (CI / staging / prod)
```bash
pnpm migrate:deploy        # prisma migrate deploy — aplica lo pendiente, nunca resetea
```

### Crear una NUEVA migración (sin tocar la DB compartida)
1. Edita `prisma/schema.prisma`.
2. Genera el SQL del delta **offline** (no se conecta a la DB):
   ```bash
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_<nombre>/migration.sql
   ```
   (crea antes la carpeta `prisma/migrations/<timestamp>_<nombre>/`)
3. Revisa el SQL a mano.
4. Aplícalo con `pnpm migrate:deploy` (en staging/prod) o `prisma db push` (en local de prototipado).
5. `prisma generate` para regenerar el cliente tipado.

### Prototipado local rápido
`pnpm push` (`prisma db push`) sigue disponible para iterar sin crear migración.
Cuando el schema se estabilice, captura el delta como migración (paso anterior).

## Baseline (referencia histórica)
La DB existente se adoptó con el procedimiento oficial de Prisma:
```bash
mkdir -p prisma/migrations/0_init
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/0_init/migration.sql
npx prisma migrate resolve --applied 0_init   # marca aplicado SIN ejecutar SQL
```
`resolve --applied` solo escribe la fila baseline en `_prisma_migrations`; no toca el schema ni los datos.
Reversible: borrar `prisma/migrations/` y la fila `0_init` de `_prisma_migrations`.
