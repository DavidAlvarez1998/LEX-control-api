import { z } from "zod";

/** Query de búsqueda de jurisprudencia: texto libre + límite opcional. */
export const jurisprudenciaQuerySchema = z.object({
  q: z.string().trim().min(2, "La búsqueda debe tener al menos 2 caracteres"),
  limite: z.coerce.number().int().positive().max(50).optional(),
});

/** Param :id de un proceso. */
export const procesoIdParams = z.object({ id: z.string().min(1) });

/** Query de la sincronización on-demand: `forzar` ignora el caché TTL. */
export const sincronizarQuerySchema = z.object({
  forzar: z.coerce.boolean().optional(),
});

/** Param :proveedor de la configuración (clave estable: cpnu/rues/corteconst). */
export const providerConfigParams = z.object({ proveedor: z.string().trim().min(1).max(40) });

/** Cuerpo del upsert de ProviderConfig. `credencial`: texto plano a CIFRAR (o null
 *  para borrarla). `habilitado`: prende/apaga el proveedor para el despacho. */
export const providerConfigBodySchema = z
  .object({
    habilitado: z.boolean().optional(),
    credencial: z.string().min(1).nullable().optional(),
    configuracion: z.record(z.unknown()).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nada que actualizar" });
