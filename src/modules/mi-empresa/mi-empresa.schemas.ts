import { z } from "zod";

/** Crear un miembro del equipo desde el portal del cliente. El rol y la empresa
 *  NO se aceptan del body: el servidor fuerza `rol=USUARIO` y `empresaId` del
 *  token (sin escalada a ADMIN ni cruce entre empresas). La contraseña la define
 *  el propio miembro vía link de activación. `esAdminEmpresa` permite crear otro
 *  administrador de la empresa. */
export const createMiembroSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  esAdminEmpresa: z.boolean().optional(),
});

/** Activar/desactivar a un miembro del equipo. */
export const updateMiembroSchema = z.object({
  activo: z.boolean(),
});

export const miembroIdParams = z.object({ id: z.string().min(1) });

export type CreateMiembroInput = z.infer<typeof createMiembroSchema>;
export type UpdateMiembroInput = z.infer<typeof updateMiembroSchema>;
