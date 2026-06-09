// Integraciones con sistemas estatales colombianos. Cada proveedor se implementa
// como un ProviderAdapter que devuelve un DTO NORMALIZADO, para que el dominio de
// procesos nunca dependa de un proveedor concreto. Tres transportes posibles:
// `api` (REST), `scrape` (portal sin API) y `aggregator` (tercero de pago).
// Ver openspec/specs/integraciones-estatales/spec.md. Fase A: solo `api`.

export type ProviderMode = "api" | "scrape" | "aggregator";

/** Actuación judicial normalizada (timeline de un proceso por su radicado). */
export type ActuacionDTO = {
  fecha: string | null; // fecha de la actuación (ISO YYYY-MM-DD si se puede)
  actuacion: string; // tipo/título de la actuación
  anotacion: string | null; // detalle/observación
  fuente: string; // proveedor que la entregó
};

/** Resultado de jurisprudencia normalizado (consulta de la Corte Constitucional). */
export type JurisprudenciaDTO = {
  providencia: string; // p. ej. "T-760/08"
  titulo: string | null;
  fecha: string | null;
  tema: string | null;
  url: string | null;
  fuente: string;
};

/** Base de todo proveedor: nombre legible + transporte. */
export interface ProviderAdapter {
  readonly nombre: string;
  readonly mode: ProviderMode;
}

/** Proveedor de actuaciones por radicado (CPNU, etc. — Fase C). */
export interface ActuacionesProvider extends ProviderAdapter {
  fetchActuaciones(radicado: string): Promise<ActuacionDTO[]>;
}

/** Proveedor de jurisprudencia (Corte Constitucional — Fase A). */
export interface JurisprudenciaProvider extends ProviderAdapter {
  buscarJurisprudencia(q: string, limite?: number): Promise<JurisprudenciaDTO[]>;
}
