// Forma de salida de Litigantes. Passthrough fiel al contrato actual (la respuesta
// ya era el modelo, con `partes/proceso` en el detalle). Seam para afinar luego.
export function toLitiganteDTO<T>(litigante: T): T {
  return litigante;
}
