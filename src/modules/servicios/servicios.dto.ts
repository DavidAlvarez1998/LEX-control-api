// Forma de salida de Servicios. Passthrough fiel (la respuesta ya era el modelo).
export function toServicioDTO<T>(servicio: T): T {
  return servicio;
}
