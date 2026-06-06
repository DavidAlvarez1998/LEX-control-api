// Helpers del módulo legal reutilizables. Extraídos del router (fix F3) para que
// el puente comercial (Solicitud de Asignación) materialice procesos con las
// MISMAS reglas. Ver openspec/changes/comercial-funnel/.
import { Prisma } from "@prisma/client";

/**
 * Genera un `codigoInterno` secuencial por empresa y año, con prefijo: directo
 * en el módulo legal usa `EXP-AAAA-NNNN`; el puente comercial usa `COM-AAAA-NNNN`
 * para distinguir el origen. El `@@unique([empresaId, codigoInterno])` respalda
 * la carrera. Debe correr dentro de una transacción.
 */
export async function generarCodigoInterno(
  tx: Prisma.TransactionClient,
  empresaId: string,
  prefijo: "EXP" | "COM" = "EXP",
): Promise<string> {
  const year = new Date().getFullYear();
  const usados = await tx.proceso.count({
    where: { empresaId, codigoInterno: { startsWith: `${prefijo}-${year}-` } },
  });
  return `${prefijo}-${year}-${String(usados + 1).padStart(4, "0")}`;
}
