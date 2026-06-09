import { Jurisdiccion } from "@prisma/client";
import { z } from "zod";
import { CAMPO_TIPOS } from "../procesos/esquema";

// --- Campo del formulario dinámico ---
const campoEsquemaSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    tipo: z.enum(CAMPO_TIPOS),
    requerido: z.boolean().default(false),
    opciones: z.array(z.string()).optional(),
    ayuda: z.string().optional(),
  })
  .refine(
    (c) =>
      !["select", "multiselect"].includes(c.tipo) ||
      (c.opciones != null && c.opciones.length > 0),
    { message: "Los campos select/multiselect requieren opciones" },
  );

// --- Etapa del flujo, con reglas ---
const reglasEtapaSchema = z.object({
  camposRequeridos: z.array(z.string()).optional(),
  documentosRequeridos: z.array(z.string()).optional(),
  plazoDias: z.number().int().positive().optional(),
});

const etapaDefSchema = z.object({
  key: z.string().min(1),
  nombre: z.string().min(1),
  orden: z.number().int(),
  terminal: z.boolean().optional(),
  resultado: z.string().optional(),
  reglas: reglasEtapaSchema.optional(),
});

export const createTipoProcesoSchema = z
  .object({
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    jurisdiccion: z.nativeEnum(Jurisdiccion),
    areaSlugs: z.array(z.string().min(1)).min(1),
    esquemaFormulario: z.array(campoEsquemaSchema).min(1),
    etapas: z.array(etapaDefSchema).min(1),
  })
  .superRefine((data, ctx) => {
    // Claves de campo únicas.
    const keys = data.esquemaFormulario.map((c) => c.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Hay claves de campo duplicadas" });
    }
    // Claves de etapa únicas.
    const ekeys = data.etapas.map((e) => e.key);
    if (new Set(ekeys).size !== ekeys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Hay claves de etapa duplicadas" });
    }
    // Las reglas de etapa deben referenciar campos existentes.
    const keySet = new Set(keys);
    for (const e of data.etapas) {
      for (const k of e.reglas?.camposRequeridos ?? []) {
        if (!keySet.has(k)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `La etapa "${e.nombre}" exige un campo inexistente: ${k}`,
          });
        }
      }
    }
  });

export const updateTipoProcesoSchema = createTipoProcesoSchema;

export const tipoIdParams = z.object({ id: z.string().min(1) });

// --- Plantillas de documento (autollenables por tipo de proceso) ---
export const createPlantillaSchema = z.object({
  nombre: z.string().min(1),
  contenido: z.string().min(1),
});

export const updatePlantillaSchema = z.object({
  nombre: z.string().min(1).optional(),
  contenido: z.string().min(1).optional(),
});

export const plantillaIdParams = z.object({ plantillaId: z.string().min(1) });
