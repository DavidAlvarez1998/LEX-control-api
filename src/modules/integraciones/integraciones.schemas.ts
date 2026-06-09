import { z } from "zod";

/** Query de búsqueda de jurisprudencia: texto libre + límite opcional. */
export const jurisprudenciaQuerySchema = z.object({
  q: z.string().trim().min(2, "La búsqueda debe tener al menos 2 caracteres"),
  limite: z.coerce.number().int().positive().max(50).optional(),
});
