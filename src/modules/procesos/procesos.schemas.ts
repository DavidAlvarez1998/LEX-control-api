import {
  CuantiaTipo,
  EstadoProceso,
  Instancia,
  Prioridad,
  RolParte,
  TipoDocumento,
  TipoPersona,
} from "@prisma/client";
import { z } from "zod";

// Una parte: o referencia un litigante existente (`litiganteId`) o crea uno
// nuevo inline (`litigante`). El cliente del prototipo manda datos inline.
const parteSchema = z
  .object({
    litiganteId: z.string().min(1).optional(),
    litigante: z
      .object({
        tipoPersona: z.nativeEnum(TipoPersona).default(TipoPersona.NATURAL),
        nombre: z.string().min(1),
        tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
        numeroDocumento: z.string().optional(),
      })
      .optional(),
    rol: z.nativeEnum(RolParte),
    rolEtiqueta: z.string().optional(),
    esNuestroCliente: z.boolean().default(false),
  })
  .refine((p) => p.litiganteId != null || p.litigante != null, {
    message: "Cada parte requiere litiganteId o litigante",
  });

export const createProcesoSchema = z.object({
  tipoProcesoId: z.string().min(1),
  titulo: z.string().min(1),
  datos: z.record(z.unknown()).default({}),
  radicado: z.string().optional(),
  despachoJuzgado: z.string().optional(),
  instancia: z.nativeEnum(Instancia).optional(),
  cuantiaTipo: z.nativeEnum(CuantiaTipo).optional(),
  cuantiaValor: z.union([z.number(), z.string()]).optional(),
  casoRelacionadoId: z.string().min(1).optional(),
  partes: z.array(parteSchema).default([]),
});

export const updateProcesoSchema = z.object({
  titulo: z.string().min(1).optional(),
  responsableId: z.string().min(1).nullable().optional(),
  radicado: z.string().nullable().optional(),
  despachoJuzgado: z.string().nullable().optional(),
  instancia: z.nativeEnum(Instancia).optional(),
  cuantiaTipo: z.nativeEnum(CuantiaTipo).nullable().optional(),
  cuantiaValor: z.union([z.number(), z.string()]).nullable().optional(),
  proximaAudiencia: z.string().nullable().optional(),
  estado: z.nativeEnum(EstadoProceso).optional(),
  prioridad: z.nativeEnum(Prioridad).optional(),
});

export const moverEtapaSchema = z.object({
  etapaKey: z.string().min(1),
  nota: z.string().optional(),
});

export const procesoIdParams = z.object({ id: z.string().min(1) });
