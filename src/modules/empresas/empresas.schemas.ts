import { z } from "zod";

/** Convierte "" en null para campos opcionales de texto. */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Body para crear una empresa. Solo el nombre es obligatorio. */
export const createEmpresaSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  rfc: optionalText, // identificador fiscal (RFC/NIT), único si se indica
  email: z
    .string()
    .trim()
    .email("Correo inválido")
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  telefono: optionalText,
  activo: z.boolean().optional(),
});

/** Body para actualizar: todos los campos opcionales. */
export const updateEmpresaSchema = createEmpresaSchema.partial();

/** Parámetro de ruta :id. */
export const empresaIdParams = z.object({
  id: z.string().min(1),
});

export type CreateEmpresaInput = z.infer<typeof createEmpresaSchema>;
export type UpdateEmpresaInput = z.infer<typeof updateEmpresaSchema>;
