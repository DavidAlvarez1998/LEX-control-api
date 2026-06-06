import { TipoDocumento, TipoPersona } from "@prisma/client";
import { z } from "zod";

export const createLitiganteSchema = z.object({
  tipoPersona: z.nativeEnum(TipoPersona).default(TipoPersona.NATURAL),
  nombre: z.string().min(1),
  tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
  numeroDocumento: z.string().optional(),
  email: z.string().email().optional(),
  telefono: z.string().optional(),
});

export const updateLitiganteSchema = createLitiganteSchema.partial();

export const litiganteIdParams = z.object({ id: z.string().min(1) });
