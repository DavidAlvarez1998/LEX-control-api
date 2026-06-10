import { z } from "zod";

// --- Enums (espejo de Prisma) ---
const tipoGestion = z.enum(["LLAMADA", "WHATSAPP", "REUNION", "VIDEOLLAMADA", "CORREO", "OTRO"]);
const estadoSeguimiento = z.enum(["PENDIENTE", "EN_GESTION", "CERRADO"]);
const faseComercial = z.enum([
  "LEAD", "CONTACTO", "EVALUACION", "PROPUESTA", "NEGOCIACION", "CONTRATO", "PODERES", "FIRMADO", "PERDIDO",
]);
const formaPago = z.enum(["CONTADO", "CUOTAS", "CUOTALITIS", "CUOTA_MIXTA", "PRIMA_EXITO"]);
const estadoPropuesta = z.enum(["PENDIENTE", "ENVIADA", "ACEPTADA", "RECHAZADA"]);
const tipoContrato = z.enum(["PRESTACION_SERVICIOS", "MANDATO", "OTRO"]);
const estadoDocFirma = z.enum(["PENDIENTE", "ENVIADO", "FIRMADO"]);
const modalidadCobro = z.enum(["CUOTALITIS", "CUOTA_MIXTA", "PRIMA_EXITO", "FIJO", "OTRO"]);

export const idParams = z.object({ id: z.string().min(1) });
const dinero = z.number().nonnegative();
const porcentaje = z.number().min(0).max(100);

// --- Seguimiento (también sirve de ítem de AGENDA: titulo + comercialId dueño) ---
export const createSeguimientoSchema = z.object({
  clienteId: z.string().min(1),
  tipoGestion,
  titulo: z.string().trim().min(1).optional(),
  motivoContacto: z.string().trim().min(1).optional(),
  resultado: z.string().trim().min(1).optional(),
  proximaTarea: z.string().trim().min(1).optional(),
  fechaProximaTarea: z.coerce.date().optional(),
  estadoSeguimiento: estadoSeguimiento.optional(),
  observaciones: z.string().trim().min(1).optional(),
  comercialId: z.string().min(1).optional(), // dueño; solo el ADMIN puede fijar otro
});
export const updateSeguimientoSchema = createSeguimientoSchema.omit({ clienteId: true }).partial();

// --- Agenda (calendario del comercial sobre los seguimientos con fechaProximaTarea) ---
export const agendaQuery = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  comercialId: z.string().min(1).optional(), // solo el ADMIN filtra por otro
  incluirCompletadas: z.coerce.boolean().optional(),
});
export const completarSeguimientoSchema = z.object({
  resultado: z.string().trim().min(1).optional(),
  fechaCompletada: z.coerce.date().optional(),
});
export const cancelarSeguimientoSchema = z.object({
  motivo: z.string().trim().min(1),
});

// --- Comisión interna del despacho (MANUAL; la registra el ADMINISTRADOR) ---
const estadoComision = z.enum(["PENDIENTE", "PAGADA", "ANULADA"]);
export const createComisionSchema = z.object({
  clienteId: z.string().min(1),
  comercialId: z.string().min(1),
  contratoId: z.string().min(1).optional(),
  baseCalculo: dinero,
  porcentaje: porcentaje.optional(),
  monto: dinero,
  estado: estadoComision.optional(),
  fechaPago: z.coerce.date().optional(),
  notas: z.string().trim().min(1).optional(),
});
export const updateComisionSchema = createComisionSchema
  .omit({ clienteId: true, comercialId: true })
  .partial();

// --- Fase (mover) ---
export const moverFaseSchema = z.object({
  fase: faseComercial,
  motivoPerdida: z.string().trim().min(1).optional(), // requerido si fase=PERDIDO (se valida en el router)
});

// --- Cotización ---
export const createCotizacionSchema = z.object({
  clienteId: z.string().min(1),
  tipoServicio: z.string().trim().min(1),
  tipoProcesoId: z.string().min(1).optional(),
  valorCotizado: dinero,
  formaPago,
  porcentajeExito: porcentaje.optional(),
  numeroCuotas: z.number().int().positive().optional(),
  fechaEnvio: z.coerce.date().optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateCotizacionSchema = createCotizacionSchema
  .omit({ clienteId: true })
  .partial()
  .extend({ estadoPropuesta: estadoPropuesta.optional(), fechaRespuesta: z.coerce.date().optional() });

// --- Contrato + poderes ---
export const createContratoSchema = z.object({
  clienteId: z.string().min(1),
  cotizacionId: z.string().min(1).optional(),
  tipoContrato,
  tipoCobroAcordado: modalidadCobro,
  valorAcordado: dinero.optional(),
  porcentajeAcordado: porcentaje.optional(),
  documentoContratoUrl: z.string().trim().min(1).optional(),
  documentoPoderUrl: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});
export const updateContratoSchema = createContratoSchema
  .omit({ clienteId: true, cotizacionId: true })
  .partial()
  .extend({
    estadoContrato: estadoDocFirma.optional(),
    estadoPoder: estadoDocFirma.optional(),
    fechaEnvio: z.coerce.date().optional(),
    fechaFirma: z.coerce.date().optional(),
  });

// --- Solicitud de Asignación de Procesos (el puente comercial→legal) ---
const prioridad = z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]);
const jurisdiccion = z.enum([
  "ORDINARIA_CIVIL", "ORDINARIA_LABORAL", "CONTENCIOSO_ADMIN", "PENAL", "CONSTITUCIONAL", "FAMILIA",
]);
const rolParte = z.enum([
  "DEMANDANTE", "DEMANDADO", "EJECUTANTE", "EJECUTADO", "ACCIONANTE", "ACCIONADO",
  "IMPUTADO", "ACUSADO", "VICTIMA", "TERCERO", "APODERADO", "OTRO",
]);

export const createSolicitudSchema = z.object({
  clienteId: z.string().min(1),
  contratoId: z.string().min(1),
  tipoProcesoId: z.string().min(1).optional(), // default: Cliente.necesidadTipoProcesoId
  prioridad: prioridad.optional(),
  jurisdiccionSugerida: jurisdiccion.optional(),
  rolParteSugerido: rolParte.optional(),
  tituloPropuesto: z.string().trim().min(1).optional(),
  notaComercial: z.string().trim().min(1).optional(),
  tareasDefinidas: z.string().trim().min(1).optional(),
});

export const asignarSolicitudSchema = z.object({
  abogadoAsignadoId: z.string().min(1),
  tipoProcesoId: z.string().min(1).optional(), // override del admin
  tareasDefinidas: z.string().trim().min(1).optional(),
});

export const rechazarSolicitudSchema = z.object({
  motivoRechazo: z.string().trim().min(1),
});

// --- Configuración de cobro (1:1 con el contrato) ---
export const configCobroSchema = z.object({
  modalidadCobro,
  valorFijo: dinero.optional(),
  porcentajeExito: porcentaje.optional(),
  numeroCuotas: z.number().int().positive().optional(),
  valorCuota: dinero.optional(),
  fechaPrimerPago: z.coerce.date().optional(),
  condicionesEspeciales: z.string().trim().min(1).optional(),
});
