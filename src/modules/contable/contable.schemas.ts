import { z } from "zod";

// --- Enums (espejo de Prisma) ---
const metodoPago = z.enum(["EFECTIVO", "TRANSFERENCIA", "CONSIGNACION", "TARJETA", "OTRO"]);
const tipoCobroIngreso = z.enum(["ANTICIPO", "CUOTA_INICIAL", "HONORARIOS", "PRIMA_EXITO", "COSTAS", "ABONO", "OTRO"]);
const estadoPagoIngreso = z.enum(["PAGADO", "PENDIENTE", "PARCIAL"]);
const tipoGastoEgreso = z.enum(["GENERAL", "POR_PROCESO"]);
const categoriaEgreso = z.enum(["NOMINA", "SERVICIOS", "PAPELERIA", "CAJA_MENOR", "COSTAS", "ARRIENDO", "IMPUESTOS", "HONORARIOS_TERCEROS", "OTRO"]);
const estadoGastoEgreso = z.enum(["PAGADO", "PENDIENTE"]);
const tipoVinculacion = z.enum(["LABORAL", "PRESTACION_SERVICIOS", "OTRO"]);
const estadoPagoNomina = z.enum(["PAGADO", "PENDIENTE"]);
const tipoMovCaja = z.enum(["SALIDA", "REPOSICION"]);
const categoriaCajaMenor = z.enum(["TRANSPORTE", "PAPELERIA", "MENSAJERIA", "ALIMENTACION", "OTRO"]);
const tipoServicioFijo = z.enum(["AGUA", "LUZ", "GAS", "INTERNET", "TELEFONO", "ARRIENDO", "SOFTWARE", "MANTENIMIENTO", "VIGILANCIA", "OTRO"]);
const estadoServicioFijo = z.enum(["PAGADO", "PENDIENTE", "VENCIDO"]);
const tipoCuentaBancaria = z.enum(["AHORROS", "CORRIENTE", "CAJA"]);
const estadoCuentaBancaria = z.enum(["ACTIVA", "INACTIVA", "CONCILIACION_PENDIENTE"]);

export const idParams = z.object({ id: z.string().min(1) });
const dinero = z.number().nonnegative();
const periodo = z.string().regex(/^\d{4}-\d{2}$/, "Periodo debe ser 'YYYY-MM'");

// --- Ingresos (append-only) ---
export const createIngresoSchema = z.object({
  clienteId: z.string().min(1),
  procesoId: z.string().min(1).optional(),
  contratoId: z.string().min(1).optional(),
  configuracionCobroId: z.string().min(1).optional(),
  cuentaId: z.string().min(1).optional(),
  fechaIngreso: z.coerce.date().optional(),
  conceptoPago: z.string().trim().min(1),
  tipoCobro: tipoCobroIngreso,
  valorRecibido: dinero,
  metodoPago,
  estadoPago: estadoPagoIngreso.optional(),
  numeroComprobante: z.string().trim().min(1).optional(),
  soportePagoUrl: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});

// --- Egresos ---
export const createEgresoSchema = z.object({
  tipoGasto: tipoGastoEgreso,
  clienteId: z.string().min(1).optional(),
  procesoId: z.string().min(1).optional(),
  cuentaId: z.string().min(1).optional(),
  fechaGasto: z.coerce.date().optional(),
  categoriaGasto: categoriaEgreso,
  subcategoria: z.string().trim().min(1).optional(),
  descripcionGasto: z.string().trim().min(1),
  valorGasto: dinero,
  medioPago: metodoPago,
  estadoGasto: estadoGastoEgreso.optional(),
  responsableId: z.string().min(1).optional(),
  soporteGastoUrl: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateEgresoSchema = createEgresoSchema.partial();

// --- Nómina ---
export const createNominaSchema = z.object({
  empleadoId: z.string().min(1).optional(),
  nombreEmpleado: z.string().trim().min(1),
  cargo: z.string().trim().min(1).optional(),
  tipoVinculacion,
  periodo,
  fechaIngreso: z.coerce.date().optional(),
  salarioHonorarios: dinero,
  auxilioTransporte: dinero.optional(),
  bonificaciones: dinero.optional(),
  descuentos: dinero.optional(),
  valorNetoPagar: dinero,
  fechaPago: z.coerce.date().optional(),
  estadoPago: estadoPagoNomina.optional(),
  cuentaId: z.string().min(1).optional(),
  comprobantePagoUrl: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateNominaSchema = createNominaSchema.partial();

// --- Caja menor ---
export const createCajaSchema = z.object({
  nombre: z.string().trim().min(1),
  montoInicial: dinero,
  responsableId: z.string().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateCajaSchema = z.object({
  estado: z.enum(["ACTIVA", "CERRADA"]).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const createMovimientoSchema = z.object({
  tipoMovimiento: tipoMovCaja.optional(),
  fechaMovimiento: z.coerce.date().optional(),
  concepto: z.string().trim().min(1),
  categoria: categoriaCajaMenor,
  valor: dinero,
  procesoId: z.string().min(1).optional(),
  medioSalida: metodoPago,
  responsableId: z.string().min(1).optional(),
  soporteUrl: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});

// --- Servicios fijos ---
export const createServicioFijoSchema = z.object({
  periodo,
  tipoServicio: tipoServicioFijo,
  proveedor: z.string().trim().min(1),
  valorFacturado: dinero,
  fechaVencimiento: z.coerce.date().optional(),
  fechaPago: z.coerce.date().optional(),
  estadoPago: estadoServicioFijo.optional(),
  cuentaId: z.string().min(1).optional(),
  soporteFacturaUrl: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateServicioFijoSchema = createServicioFijoSchema.partial();

// --- Cuentas / bolsas ---
export const createCuentaSchema = z.object({
  entidadBancaria: z.string().trim().min(1),
  tipoCuenta: tipoCuentaBancaria,
  numeroCuenta: z.string().trim().min(1).optional(),
  nombreBolsa: z.string().trim().min(1),
  saldoInicial: dinero.optional(),
  estadoCuenta: estadoCuentaBancaria.optional(),
  responsableId: z.string().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateCuentaSchema = createCuentaSchema.partial();

// --- Cartera ---
export const createCarteraSchema = z.object({
  contratoId: z.string().min(1),
  procesoId: z.string().min(1).optional(),
  responsableId: z.string().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});

export const reporteQuery = z.object({ periodo });
