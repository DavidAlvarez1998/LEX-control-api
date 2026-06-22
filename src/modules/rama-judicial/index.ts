// Capacidad de consulta de la RAMA JUDICIAL (CPNU): radicado → idProceso →
// actuaciones. Solo lectura, sin auth, puerto 448. El negocio importa desde aquí.
export { consultarRadicado, obtenerActuaciones, obtenerDetalle, obtenerSujetos, obtenerDocumentos, descargarDocumento } from "./rama-judicial.client";
export type { ProcesoRama, ActuacionRama, DetalleRama, DocumentoRama, SujetoRama } from "./rama-judicial.types";
