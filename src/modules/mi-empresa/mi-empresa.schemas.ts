import { RolEmpresa } from "@prisma/client";
import { z } from "zod";

/** Lista de roles de empresa: no vacía y sin duplicados. */
const rolesArray = z
  .array(z.nativeEnum(RolEmpresa))
  .min(1, "Selecciona al menos un rol")
  .transform((arr) => [...new Set(arr)]);

/** Crear un miembro del equipo desde el portal del cliente. El rol de plataforma
 *  y la empresa NO se aceptan del body: el servidor fuerza `rol=USUARIO` y
 *  `empresaId` del token (sin escalada a ADMIN ni cruce entre empresas). La
 *  contraseña la define el propio miembro vía link de activación. `roles` son los
 *  RolEmpresa (sillas) que ocupará; incluir ADMINISTRADOR lo hace admin de la
 *  empresa (espejo de `esAdminEmpresa`). */
export const createMiembroSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  roles: rolesArray,
  // Datos del abogado para firmar escritos generados (poder, demanda, etc.).
  cedula: z.string().trim().optional(),
  tarjetaProfesional: z.string().trim().optional(),
});

/** Actualizar un miembro: activar/desactivar y/o reconciliar su conjunto de
 *  roles. Debe traer al menos uno de los dos. */
export const updateMiembroSchema = z
  .object({
    activo: z.boolean().optional(),
    roles: rolesArray.optional(),
  })
  .refine((d) => d.activo !== undefined || d.roles !== undefined, {
    message: "Nada que actualizar (envía `activo` y/o `roles`)",
  });

export const miembroIdParams = z.object({ id: z.string().min(1) });

/** Auto-edición del perfil profesional propio (cualquier USUARIO edita lo SUYO).
 *  Solo datos del abogado para firmar escritos (cédula, tarjeta profesional) y el
 *  teléfono personal. Nombre/correo/contraseña son identidad/login → no aquí.
 *  Cadena vacía = limpiar el campo (se persiste como null en el servicio). */
export const updatePerfilSchema = z.object({
  cedula: z.string().trim().max(40).optional(),
  tarjetaProfesional: z.string().trim().max(60).optional(),
  telefono: z.string().trim().max(40).optional(),
});

export type CreateMiembroInput = z.infer<typeof createMiembroSchema>;
export type UpdateMiembroInput = z.infer<typeof updateMiembroSchema>;
export type UpdatePerfilInput = z.infer<typeof updatePerfilSchema>;
