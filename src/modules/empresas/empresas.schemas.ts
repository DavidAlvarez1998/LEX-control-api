import { z } from "zod";

/** Convierte "" en null para campos opcionales de texto. */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/**
 * Asignación de un servicio del catálogo a la empresa, con los precios
 * negociados para ella. Solo `servicioId` es obligatorio: los campos de precio
 * omitidos se rellenan en el router con los valores de referencia del catálogo.
 */
export const servicioAsignadoSchema = z.object({
  servicioId: z.string().min(1, "servicioId es obligatorio"),
  precioBase: z.number().nonnegative().optional(),
  precioPorUnidad: z.number().nonnegative().optional(),
  incluidos: z.number().int().nonnegative().optional(),
  activo: z.boolean().optional(),
});

/** Lista de servicios contratados; sin `servicioId` duplicados. */
const serviciosArray = z
  .array(servicioAsignadoSchema)
  .refine(
    (arr) => new Set(arr.map((s) => s.servicioId)).size === arr.length,
    "Hay servicios duplicados en la asignación",
  )
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
  // Servicios contratados con sus precios por empresa (opcional).
  servicios: serviciosArray,
});

/** Body para actualizar: todos los campos opcionales. */
export const updateEmpresaSchema = createEmpresaSchema.partial();

/** Parámetro de ruta :id. */
export const empresaIdParams = z.object({
  id: z.string().min(1),
});

export type CreateEmpresaInput = z.infer<typeof createEmpresaSchema>;
export type UpdateEmpresaInput = z.infer<typeof updateEmpresaSchema>;
export type ServicioAsignadoInput = z.infer<typeof servicioAsignadoSchema>;
