import { z } from "zod";

// Módulo de venta de la plataforma (prospectos + comisiones). Ver
// openspec/changes/admin-comercial-ventas/.

const canalEntrada = z.enum(["WEB", "WHATSAPP", "DIRECTO", "REFERIDO", "LLAMADA", "REDES_SOCIALES", "OTRO"]);
// Estados NO terminales: a GANADO/PERDIDO solo se llega por /ganar y /perder.
const estadoProspectoEditable = z.enum(["NUEVO", "CONTACTADO", "COTIZADO", "NEGOCIACION"]);

export const idParams = z.object({ id: z.string().min(1) });
const dinero = z.number().nonnegative();

export const createProspectoSchema = z.object({
  nombreEmpresa: z.string().trim().min(1),
  nombreContacto: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  telefono: z.string().trim().min(1).optional(),
  cargo: z.string().trim().min(1).optional(),
  canalEntrada: canalEntrada.optional(),
  planInteresId: z.string().min(1).optional(),
  comercialId: z.string().min(1).optional(), // solo ADMIN puede fijarlo; COMERCIAL → sí mismo
  notas: z.string().trim().min(1).optional(),
});

export const updateProspectoSchema = z.object({
  nombreEmpresa: z.string().trim().min(1).optional(),
  nombreContacto: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  telefono: z.string().trim().min(1).optional(),
  cargo: z.string().trim().min(1).optional(),
  canalEntrada: canalEntrada.optional(),
  estado: estadoProspectoEditable.optional(),
  planInteresId: z.string().min(1).nullable().optional(),
  comercialId: z.string().min(1).nullable().optional(), // solo ADMIN
  notas: z.string().trim().min(1).optional(),
});

export const ganarSchema = z.object({
  planId: z.string().min(1).optional(), // default = planInteresId
  precioVenta: dinero.optional(), // default = Plan.precioMensual
  montoComisionFijo: dinero.optional(), // sobreescribe el % del comercial
});

export const perderSchema = z.object({
  motivoPerdida: z.string().trim().min(1),
});

export const comisionPatchSchema = z.object({
  estado: z.enum(["PAGADA", "ANULADA"]),
  fechaPago: z.coerce.date().optional(),
  notas: z.string().trim().min(1).optional(),
});
