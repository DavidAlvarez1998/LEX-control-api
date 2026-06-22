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
  fechaUltimaActuacion: string | null;
  /** true = proceso reservado/privado (la Rama no muestra sus actuaciones). */
  esPrivado: boolean;
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
