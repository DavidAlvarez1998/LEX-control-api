import { Jurisdiccion, TipoAreaPractica } from "@prisma/client";
import { z } from "zod";
import { CAMPO_TIPOS, camposDeCondicion, type Condicion } from "../procesos/esquema";

// --- Condición (mostrarSi/requeridoSi/disponibleSi): hoja {campo,igualA} o
//     compuesta {todas:[...]} (AND) / {alguna:[...]} (OR), recursiva. ---
const condicionSchema: z.ZodType<Condicion> = z.lazy(() =>
  z.union([
    z.object({
      campo: z.string().min(1),
      igualA: z.union([z.string(), z.array(z.string()).min(1)]),
    }),
    z.object({ todas: z.array(condicionSchema).min(1) }),
    z.object({ alguna: z.array(condicionSchema).min(1) }),
  ]),
);

// --- Campo del formulario dinámico ---
const campoEsquemaSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    tipo: z.enum(CAMPO_TIPOS),
    requerido: z.boolean().default(false),
    opciones: z.array(z.string()).optional(),
    ayuda: z.string().optional(),
    mostrarSi: condicionSchema.optional(),
    requeridoSi: condicionSchema.optional(),
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
  // Requeridos condicionales (aplican solo cuando `si` se cumple).
  requeridosSi: z
    .array(
      z.object({
        si: condicionSchema,
        camposRequeridos: z.array(z.string()).optional(),
        documentosRequeridos: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  // Derivación de vencimiento (extiende plazoDias): fechaLimite solo si hay plazoDesdeCampo.
  plazoDesdeCampo: z.string().min(1).optional(),
  plazoTipoDias: z.enum(["habiles", "calendario"]).optional(),
  plazoDiasPorValorDe: z
    .object({ campo: z.string().min(1), mapa: z.record(z.number().int().positive()) })
    .optional(),
});

const etapaDefSchema = z.object({
  key: z.string().min(1),
  nombre: z.string().min(1),
  orden: z.number().int(),
  terminal: z.boolean().optional(),
  resultado: z.string().optional(),
  reglas: reglasEtapaSchema.optional(),
  disponibleSi: condicionSchema.optional(),
  accion: z
    .object({
      tipo: z.literal("crearDerivado"),
      tipoDestinoNombre: z.string().min(1),
      copiarDatos: z.array(z.string()).optional(),
      copiarCliente: z.boolean().optional(),
    })
    .optional(),
});

export const createTipoProcesoSchema = z
  .object({
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    jurisdiccion: z.nativeEnum(Jurisdiccion),
    esJudicial: z.boolean().optional(), // default true en BD; false = trámite ante entidad (DdP)
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
    // Toda referencia a un campo (en reglas, condiciones y plazos) debe existir.
    const keySet = new Set(keys);
    const refCampo = (k: string, contexto: string) => {
      if (!keySet.has(k)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${contexto} referencia un campo inexistente: ${k}` });
      }
    };

    // Refs de una condición (hoja o compuesta): valida TODOS los campos que toca.
    const refCond = (cond: Condicion, contexto: string) => {
      for (const k of camposDeCondicion(cond)) refCampo(k, contexto);
    };

    // Condiciones a nivel de campo (mostrarSi/requeridoSi).
    for (const c of data.esquemaFormulario) {
      if (c.mostrarSi) refCond(c.mostrarSi, `El campo "${c.label}" (mostrarSi)`);
      if (c.requeridoSi) refCond(c.requeridoSi, `El campo "${c.label}" (requeridoSi)`);
    }

    for (const e of data.etapas) {
      const et = `La etapa "${e.nombre}"`;
      for (const k of e.reglas?.camposRequeridos ?? []) refCampo(k, et);
      for (const r of e.reglas?.requeridosSi ?? []) {
        refCond(r.si, `${et} (requeridosSi.si)`);
        for (const k of r.camposRequeridos ?? []) refCampo(k, `${et} (requeridosSi)`);
      }
      if (e.reglas?.plazoDesdeCampo) refCampo(e.reglas.plazoDesdeCampo, `${et} (plazoDesdeCampo)`);
      if (e.reglas?.plazoDiasPorValorDe) refCampo(e.reglas.plazoDiasPorValorDe.campo, `${et} (plazoDiasPorValorDe)`);
      if (e.disponibleSi) refCond(e.disponibleSi, `${et} (disponibleSi)`);
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

// --- Áreas de práctica (catálogo global; solo ADMIN gestiona) ---
export const createAreaSchema = z.object({
  nombre: z.string().min(1),
  jurisdiccion: z.nativeEnum(Jurisdiccion),
  tipo: z.nativeEnum(TipoAreaPractica).default("PRACTICA"),
  activo: z.boolean().default(true),
  orden: z.number().int().optional(),
});

export const updateAreaSchema = z.object({
  nombre: z.string().min(1).optional(),
  jurisdiccion: z.nativeEnum(Jurisdiccion).optional(),
  tipo: z.nativeEnum(TipoAreaPractica).optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().optional(),
});

export const areaIdParams = z.object({ id: z.string().min(1) });
