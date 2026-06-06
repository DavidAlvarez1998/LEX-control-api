import { z } from "zod";

const cuota = z.number().int().nonnegative().nullable(); // null = ilimitado
const cuotas = z.object({
  ADMINISTRADOR: cuota.optional(),
  JURIDICO: cuota.optional(),
  CONTABLE: cuota.optional(),
  COMERCIAL: cuota.optional(),
});

export const createPlanSchema = z.object({
  clave: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Clave en minúsculas (ej. bufete_pro)"),
  nombre: z.string().trim().min(1),
  precioMensual: z.number().nonnegative(),
  orden: z.number().int().optional(),
  activo: z.boolean().optional(),
  modulos: z.array(z.string().min(1)).default([]), // claves de módulos NO-baseline
  cuotas: cuotas.default({}),
});

export const updatePlanSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  precioMensual: z.number().nonnegative().optional(),
  orden: z.number().int().optional(),
  activo: z.boolean().optional(),
  modulos: z.array(z.string().min(1)).optional(), // si viene, reemplaza el set
  cuotas: cuotas.optional(), // si viene, reemplaza el set
});

export const planIdParams = z.object({ id: z.string().min(1) });
export const asignarPlanSchema = z.object({ planId: z.string().min(1) });
