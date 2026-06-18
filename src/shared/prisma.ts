// Punto único de acceso al cliente Prisma para la capa de repositorios.
// Re-exporta el MISMO singleton de `src/index` (no crear nunca otro PrismaClient:
// múltiples instancias agotan el pool de conexiones de MySQL).
import { prisma } from "../index";

export { prisma };

// Tipo "cliente Prisma o transacción": las firmas de repositorio aceptan tanto el
// singleton como el `tx` que entrega `prisma.$transaction(async (tx) => …)`, para
// que todas las escrituras de un caso de uso participen en la misma transacción.
export type PrismaLike = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
