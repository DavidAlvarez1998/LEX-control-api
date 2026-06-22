// DTOs normalizados de la API de la Rama Judicial (CPNU). Las respuestas crudas se
// normalizan en el client; el resto del sistema solo ve estos tipos.

/** Resultado de consultar un radicado (Endpoint A). `encontrado=false` cuando la
 *  Rama devuelve `procesos: []` (el radicado no existe / no está publicado). */
export type ProcesoRama = {
  encontrado: boolean;
  idProceso: number | null;
  despacho: string | null;
  departamento: string | null;
  sujetosProcesales: string | null;
  /** Fecha en que el proceso se radicó/repartió en la Rama (autollena fechaRadicacion). */
  fechaProceso: string | null;
  fechaUltimaActuacion: string | null;
  /** true = proceso reservado/privado (la Rama no muestra sus actuaciones). */
  esPrivado: boolean;
};

/** Detalle del proceso en la Rama (Endpoint Detalle). Dato estrella: `ubicacion`. */
export type DetalleRama = {
  tipoProceso: string | null;
  claseProceso: string | null;
  subclaseProceso: string | null;
  ponente: string | null;
  recurso: string | null;
  ubicacion: string | null;
  contenidoRadicacion: string | null;
  ultimaActualizacion: string | null;
};

/** Un documento del expediente (Endpoint Documentos). Se descarga por `idRegDocumento`. */
export type DocumentoRama = {
  idRegDocumento: number;
  descripcion: string | null;
  fechaCarga: string | null;
  consActuacion: number | null; // actuación a la que pertenece (correlación)
};

/** Una actuación (movimiento) del juzgado (Endpoint B). Título = texto libre. */
export type ActuacionRama = {
  fechaActuacion: string | null;
  actuacion: string;
  anotacion: string | null;
  fechaInicial: string | null;
  fechaFinal: string | null;
  fechaRegistro: string | null;
};
