// Forma de salida del módulo Clientes. Es el ÚNICO punto donde se define la
// respuesta. HOY es fiel al contrato actual (la respuesta ya era el modelo, con
// `responsableComercial` en list/detail) → passthrough con cero diff. El seam
// permite afinar la forma más adelante SIN tocar router ni service.
export function toClienteDTO<T>(cliente: T): T {
  return cliente;
}
