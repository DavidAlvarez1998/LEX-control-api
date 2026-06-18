# Arquitectura — `lex-control-api`

**Arquitectura modular en capas** (layered) sobre un **monolito modular** — una _Clean
Architecture pragmática_ con los patrones **Service Layer + Repository + DTO**, sin
sobre-ingeniería (sin NestJS, sin hexagonal/puertos por todo, sin CQRS).

> Establecida por el change OpenSpec `api-arquitectura-refactor` (2026-06-18). Spec
> canónica: `openspec/specs/api-architecture/`. Resultado: **18/18 routers** sin llamadas
> `prisma.` directas; el contrato HTTP es independiente de esta estructura interna (los
> frontends no dependen de ella).

## Las capas y la regla de dependencia

```
HTTP
 │
 ▼
 Router  ─→  Service  ─→  Repository  ─→  Prisma (singleton)
(solo HTTP) (negocio)    (datos)
    └──────────→ DTO (forma de la respuesta)

domain/        ← lógica pura (motor de procesos): sin Express, sin Prisma
shared/        ← transversal: prisma, tenant, errors, pagination, logger
```

**Regla rectora (dependency rule):** las dependencias apuntan **solo hacia adentro**.

| Capa | Archivo | Responsabilidad | NO hace |
|---|---|---|---|
| **Router** | `<f>.router.ts` | rutas, status, middleware (auth/validate), llamar al service, mapear con el DTO | lógica de negocio, Prisma |
| **Service** | `<f>.service.ts` | casos de uso, reglas, orquestación, **transacciones**, autorización de negocio | tocar `req`/`res`, Prisma directo |
| **Repository** | `<f>.repository.ts` | queries Prisma, **scoping `empresaId` forzado**, paginación | reglas de negocio |
| **DTO / mapper** | `<f>.dto.ts` | forma de la respuesta (modelo → API) | — |
| **Schemas** | `<f>.schemas.ts` | validación Zod de entrada + tipos `z.infer` | — |
| **Domain** | `modules/procesos/maquina-etapas.ts`, `esquema.ts`, `diasHabiles.ts` | lógica pura (máquina de etapas, plazos) | Express, Prisma |
| **Shared** | `src/shared/*` | logger, errores, paginación, tenant, prisma | lógica de un feature |

## Invariantes (lo que da el nivel "profesional")

1. **Prisma singleton.** Una sola instancia (`shared/prisma.ts`, re-exporta `src/index`).
   Lo que se **inyecta por request es el `TenantContext`** (`{ userId, rol, empresaId,
   esAdminEmpresa, rolesEmpresa }`), NO una instancia de Prisma.
2. **Scoping multi-tenant forzado en el repositorio.** El `empresaId` se fija al construir
   el repo → es **imposible olvidarlo** en una query (evita fugas entre despachos).
3. **Transacciones en el service.** El service abre `prisma.$transaction(tx => …)` y construye
   el repo con `tx` (`new XRepository(empresaId, tx)`) para que todas las escrituras del caso
   de uso sean atómicas.
4. **Router fino.** Solo HTTP + middleware; la lógica vive en el service.
5. **Dominio puro.** El motor de procesos es testeable sin HTTP ni DB (ver
   `tests/maquina-etapas.test.ts`).
6. **Middleware solo en el router** (auth/RBAC/validate/requestId). Los services son
   _transport-agnostic_.
7. **Errores centralizados.** `shared/errors.ts` (`mapPrismaError`: P2002→409, P2025→404,
   P2003→409) + `middleware/error.ts`. Los mensajes específicos de cada módulo se lanzan como
   `HttpError` y tienen prioridad.

## Estructura de carpetas

```
src/
  shared/{prisma,tenant,errors,pagination,logger}.ts
  middleware/{auth,error,validate,async}.ts
  config/env.ts
  modules/<feature>/
    <f>.router.ts      # HTTP fino
    <f>.service.ts     # casos de uso
    <f>.repository.ts  # acceso a datos (empresaId forzado)
    <f>.dto.ts         # forma de salida
    <f>.schemas.ts     # Zod (entrada) + tipos
  modules/procesos/maquina-etapas.ts   # dominio puro
```

## Cómo agregar un endpoint / módulo nuevo

1. **Schema** (`<f>.schemas.ts`): Zod de entrada + exporta los tipos (`z.infer`).
2. **Repository** (`<f>.repository.ts`): mete ahí TODA query Prisma; recibe el `empresaId`
   (o el tenant) en el constructor; acepta un client opcional para transacciones.
3. **Service** (`<f>.service.ts`): caso de uso; recibe `TenantContext`; orquesta repo + reglas;
   abre transacciones si hay multi-write.
4. **DTO** (`<f>.dto.ts`): mapea el modelo a la forma de la respuesta.
5. **Router** (`<f>.router.ts`): `requireAuth`/`requirePermiso`/`validate` → `service` →
   `res.json(dto(...))`. Sin `prisma.`.
6. Móntalo en `src/app.ts`.

### Regla mental
**middleware = puerta (router)** · **lógica = service** · **datos + tenant = repository** ·
**forma = dto** · **Prisma = una sola instancia compartida**.

## Verificación
- `pnpm test` (vitest + supertest, contra DB real) — gate de comportamiento.
- `pnpm build` / `npx tsc --noEmit` — tipos.
- Invariante de router: `grep -rE "\bprisma\." src/modules/*/*.router.ts` debe dar **0**.

## Fuera de alcance (futuro)
- **Paginación**: helper `shared/pagination` disponible y back-compatible; el rollout a los
  listados que el front ya consume se coordina con un cambio de frontend.
- **OpenAPI**: generar el contrato + tipos compartidos con los frontends.
