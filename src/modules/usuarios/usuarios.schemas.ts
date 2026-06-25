import { z } from "zod";

/** Crear usuario de empresa. El ADMIN lo crea; la contraseña la define el
 *  propio usuario vía link de activación, por eso no va acá. */
export const createUsuarioSchema = z
  .object({
    email: z.string().trim().email("Correo inválido"),
    nombre: z.string().trim().min(1, "El nombre es obligatorio"),
    // Opcional: los roles de plataforma (ADMIN/COMERCIAL) no tienen empresa.
    empresaId: z.string().min(1).optional(),
    rol: z.enum(["ADMIN", "USUARIO", "COMERCIAL"]).optional(), // default USUARIO
    esAdminEmpresa: z.boolean().optional(),
    // Solo para COMERCIAL: % de comisión por defecto del vendedor.
    porcentajeComision: z.number().min(0).max(100).optional(),
    // Datos del abogado para firmar escritos generados (poder, demanda, etc.).
    cedula: z.string().trim().optional(),
    tarjetaProfesional: z.string().trim().optional(),
  })
  // Un USUARIO de empresa SÍ requiere empresa; un rol de plataforma NO.
  .refine((d) => (d.rol ?? "USUARIO") !== "USUARIO" || !!d.empresaId, {
    message: "La empresa es obligatoria para un usuario de empresa",
    path: ["empresaId"],
  });

/** Actualizar: campos editables por el ADMIN (no incluye contraseña). */
export const updateUsuarioSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  rol: z.enum(["ADMIN", "USUARIO", "COMERCIAL"]).optional(),
  activo: z.boolean().optional(),
  esAdminEmpresa: z.boolean().optional(),
  porcentajeComision: z.number().min(0).max(100).nullable().optional(),
  cedula: z.string().trim().optional(),
  tarjetaProfesional: z.string().trim().optional(),
});

export const usuarioIdParams = z.object({ id: z.string().min(1) });

export type CreateUsuarioInput = z.infer<typeof createUsuarioSchema>;
export type UpdateUsuarioInput = z.infer<typeof updateUsuarioSchema>;
