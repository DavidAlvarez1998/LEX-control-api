// Adapter de la Corte Constitucional (mode `api`): consulta jurisprudencia sobre
// la API pública Socrata SODA de datos.gov.co (relatoría). Aislado como los demás
// clientes externos (ver documentos.client.ts): solo este archivo hace `fetch`;
// cambiar de dataset/host es tocar env.integraciones, no el router.
//
// SODA: GET {baseUrl}/resource/{datasetId}.json?$q={texto}&$limit={n}
// Los nombres de columna varían por dataset → se normalizan defensivamente.

import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";
import type { JurisprudenciaDTO, JurisprudenciaProvider } from "./integraciones.types";

const FUENTE = "Corte Constitucional";

/** Lee la primera clave no vacía de un registro (los datasets nombran distinto). */
function primera(reg: Record<string, unknown>, claves: string[]): string | null {
  for (const k of claves) {
    const v = reg[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Normaliza un registro SODA a JurisprudenciaDTO (tolerante a esquemas distintos). */
function normalizar(reg: Record<string, unknown>): JurisprudenciaDTO {
  return {
    providencia:
      primera(reg, ["providencia", "sentencia", "numero_sentencia", "id_sentencia", "radicacion"]) ?? "—",
    titulo: primera(reg, ["titulo", "tema", "descriptor", "sintesis", "asunto"]),
    fecha: primera(reg, ["fecha", "fecha_sentencia", "fecha_providencia", "ano", "anio"]),
    tema: primera(reg, ["tema", "tesis", "descriptores", "materia"]),
    url: primera(reg, ["url", "enlace", "link", "documento"]),
    fuente: FUENTE,
  };
}

/**
 * Consulta jurisprudencia por texto libre. Devuelve resultados normalizados.
 * Lanza HttpError(502) si la API no responde a tiempo, falla o devuelve algo
 * que no es una lista — para que el router no entregue datos a medias.
 */
async function buscarJurisprudencia(q: string, limite = 20): Promise<JurisprudenciaDTO[]> {
  const { baseUrl, datasetId, timeoutMs, appToken } = env.integraciones.corteConstitucional;
  const url =
    `${baseUrl}/resource/${encodeURIComponent(datasetId)}.json` +
    `?$q=${encodeURIComponent(q)}&$limit=${Math.min(Math.max(1, limite), 50)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(appToken ? { "X-App-Token": appToken } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    const abortado = err instanceof DOMException && err.name === "AbortError";
    throw new HttpError(
      502,
      abortado
        ? "La consulta a la Corte Constitucional no respondió a tiempo. Intenta de nuevo."
        : "No se pudo conectar con la API de la Corte Constitucional.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new HttpError(502, `La API de la Corte Constitucional respondió ${res.status}.`);
  }

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    throw new HttpError(502, "La API de la Corte Constitucional devolvió un formato inesperado.");
  }

  return data.map((reg) => normalizar(reg as Record<string, unknown>));
}

export const corteConstitucionalAdapter: JurisprudenciaProvider = {
  nombre: FUENTE,
  mode: "api",
  buscarJurisprudencia,
};
