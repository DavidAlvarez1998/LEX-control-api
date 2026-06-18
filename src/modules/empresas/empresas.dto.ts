// Forma de salida de Empresas. Passthrough fiel (la respuesta ya era el modelo con
// sus includes: _count/servicios en list, usuarios/servicios en detalle).
export function toEmpresaDTO<T>(empresa: T): T {
  return empresa;
}
