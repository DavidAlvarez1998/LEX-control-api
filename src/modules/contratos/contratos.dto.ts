// Forma de salida de Contratos: añade la URL pública a cada documento adjunto.
import { construirUrlDocumento } from "../documentos/documentos.client";

export function serializeContrato<T extends { documentos: { path: string }[] }>(c: T) {
  return { ...c, documentos: c.documentos.map((d) => ({ ...d, url: construirUrlDocumento(d.path) })) };
}
