import { z } from "zod";

/**
 * Body para crear un servicio. Modelo de cobro: precioBase (costo fijo) +
 * precioPorUnidad (costo por unidad por encima de las incluidas). `unidad`
 * indica qué se cuenta; null/omitido = servicio de costo fijo.
 */
export const createServicioSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  descripcion: z.string().trim().optional().nullable(),
  precioBase: z.coerce.number().nonnegative("El precio no puede ser negativo"),
  precioPorUnidad: z.coerce
    .number()
    .nonnegative("El precio por unidad no puede ser negativo")
    .optional(),
  unidad: z.string().trim().min(1).optional().nullable(),
  incluidos: z.coerce
    .number()
    .int()
    .nonnegative("Las unidades incluidas no pueden ser negativas")
    .optional(),
  activo: z.boolean().optional(),
});

/** Body para actualizar: todos los campos opcionales (PATCH parcial). */
export const updateServicioSchema = createServicioSchema.partial();

/** Parámetro de ruta :id (cuid). */
export const servicioIdParams = z.object({
  id: z.string().min(1),
});

export type CreateServicioInput = z.infer<typeof createServicioSchema>;
export type UpdateServicioInput = z.infer<typeof updateServicioSchema>;
