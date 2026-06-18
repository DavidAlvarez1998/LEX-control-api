import { z } from "zod";

// Espejo de los enums Prisma usados por los pagos (un pago es un Ingreso).
const metodoPago = z.enum(["EFECTIVO", "TRANSFERENCIA", "CONSIGNACION", "TARJETA", "OTRO"]);
const tipoCobroIngreso = z.enum(["ANTICIPO", "CUOTA_INICIAL", "HONORARIOS", "PRIMA_EXITO", "COSTAS", "ABONO", "OTRO"]);
const estadoFactura = z.enum(["BORRADOR", "EMITIDA", "ANULADA"]);

export const idParams = z.object({ id: z.string().min(1) });

export const listFacturasQuery = z.object({
  estado: estadoFactura.optional(),
  clienteId: z.string().min(1).optional(),
});

// Línea de detalle. total se calcula en el servidor (cantidad * valorUnitario).
const itemSchema = z.object({
  descripcion: z.string().trim().min(1),
  cantidad: z.number().int().min(1).default(1),
  valorUnitario: z.number().positive(),
});

export const createFacturaSchema = z.object({
  clienteId: z.string().min(1),
  contratoId: z.string().min(1).optional(),
  configuracionCobroId: z.string().min(1).optional(),
  procesoId: z.string().min(1).optional(),
  fechaVencimiento: z.coerce.date().optional(),
  porcentajeIva: z.number().min(0).max(100).optional(), // default 19 en el modelo
  observaciones: z.string().trim().min(1).optional(),
  items: z.array(itemSchema).min(1, "La factura necesita al menos un ítem"),
});

// Edición de un BORRADOR: todo opcional; si llegan items, recalcula totales.
export const updateFacturaSchema = z.object({
  fechaVencimiento: z.coerce.date().nullable().optional(),
  porcentajeIva: z.number().min(0).max(100).optional(),
  observaciones: z.string().trim().min(1).nullable().optional(),
  items: z.array(itemSchema).min(1).optional(),
});

export const anularFacturaSchema = z.object({
  motivo: z.string().trim().min(1, "Indica el motivo de la anulación"),
});

// Un pago de factura = un Ingreso vinculado (Ingreso.facturaId).
export const pagoFacturaSchema = z.object({
  valorRecibido: z.number().positive(),
  metodoPago,
  tipoCobro: tipoCobroIngreso.optional(), // default ABONO en el router
  fechaIngreso: z.coerce.date().optional(),
  cuentaId: z.string().min(1).optional(),
  numeroComprobante: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});

export type CreateFacturaInput = z.infer<typeof createFacturaSchema>;
export type UpdateFacturaInput = z.infer<typeof updateFacturaSchema>;
export type PagoFacturaInput = z.infer<typeof pagoFacturaSchema>;
