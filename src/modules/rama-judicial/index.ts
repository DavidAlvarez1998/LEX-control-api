// Capacidad de consulta de la RAMA JUDICIAL (CPNU): radicado → idProceso →
// actuaciones. Solo lectura, sin auth, puerto 448. El negocio importa desde aquí.
export { consultarRadicado, obtenerActuaciones } from "./rama-judicial.client";
export type { ProcesoRama, ActuacionRama } from "./rama-judicial.types";
