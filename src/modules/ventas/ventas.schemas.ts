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
  referidoPor: z.string().trim().min(1).optional(), // quién lo refirió (canal REFERIDO)
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
  referidoPor: z.string().trim().min(1).nullable().optional(),
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

// Editar una comisión: todo opcional (estado, monto, %, fecha de pago, notas).
export const comisionPatchSchema = z.object({
  estado: z.enum(["PENDIENTE", "PAGADA", "ANULADA"]).optional(),
  monto: dinero.optional(),
  porcentaje: z.number().min(0).max(100).nullable().optional(),
  fechaPago: z.coerce.date().nullable().optional(),
  notas: z.string().trim().min(1).nullable().optional(),
});

// ===================== SEGUIMIENTO / AGENDA =====================
// tipo de actividad: reutiliza el enum Prisma TipoGestionComercial.
const tipoGestion = z.enum(["LLAMADA", "WHATSAPP", "REUNION", "VIDEOLLAMADA", "CORREO", "OTRO"]);

export const createSeguimientoSchema = z.object({
  tipo: tipoGestion.optional(), // default LLAMADA
  titulo: z.string().trim().min(1).optional(),
  nota: z.string().trim().min(1).optional(),
  resultado: z.string().trim().min(1).optional(),
  // Si llega -> agendada (pendiente); si se omite -> registrada como hecha ahora.
  fechaProgramada: z.coerce.date().optional(),
  comercialId: z.string().min(1).optional(), // solo ADMIN; default = dueño del prospecto
});

export const updateSeguimientoSchema = z.object({
  tipo: tipoGestion.optional(),
  titulo: z.string().trim().min(1).nullable().optional(),
  nota: z.string().trim().min(1).nullable().optional(),
  resultado: z.string().trim().min(1).nullable().optional(),
  fechaProgramada: z.coerce.date().nullable().optional(),
  comercialId: z.string().min(1).nullable().optional(), // solo ADMIN
});

export const completarSeguimientoSchema = z.object({
  resultado: z.string().trim().min(1).optional(),
  fechaCompletada: z.coerce.date().optional(), // default = now
});

export const cancelarSeguimientoSchema = z.object({
  motivo: z.string().trim().min(1, "Indica el motivo de la cancelación"),
});

export const agendaQuery = z.object({
  desde: z.coerce.date().optional(), // default = hoy
  hasta: z.coerce.date().optional(), // default = hoy
  comercialId: z.string().min(1).optional(), // solo ADMIN
  // Incluir también las completadas (para verlas en gris en el calendario).
  incluirCompletadas: z.enum(["true", "false", "1", "0"]).optional().transform((v) => v === "true" || v === "1"),
});
