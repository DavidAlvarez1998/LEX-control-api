// Mapeo central de errores de Prisma a HttpError, para que los routers/servicios
// dejen de manejar P2002/P2025/P2003 a mano. Lo consume el error handler central:
// solo afecta a errores de Prisma que llegan SIN manejar (hoy caen a 500); el
// manejo explícito que ya exista en un router sigue teniendo prioridad.
import { Prisma } from "@prisma/client";
import { HttpError } from "../middleware/error";

/**
 * Traduce un error conocido de Prisma a HttpError. Devuelve null si no es un error
 * de Prisma mapeable (el handler central lo tratará como 500).
 */
export function mapPrismaError(err: unknown): HttpError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": // unique constraint
        return new HttpError(409, "Ya existe un registro con esos datos");
      case "P2025": // record not found (update/delete)
        return new HttpError(404, "Registro no encontrado");
      case "P2003": // foreign key constraint
        return new HttpError(409, "Operación bloqueada por una relación existente");
      default:
        return null;
    }
  }
  return null;
}
