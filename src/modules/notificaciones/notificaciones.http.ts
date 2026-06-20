// Transporte HTTP del microservicio de notificaciones (API_NOTIFICAR). Es el
// ÚNICO lugar del módulo que hace `fetch` afuera: los clients de cada canal
// (correo/sms/llamadas) solo arman el payload y normalizan la respuesta.
// Cambiar de host/entorno = tocar env.notificaciones, no los canales.

import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";

const FUENTE = "el servicio de notificaciones";

/** Hace la request con timeout y traduce cualquier fallo a HttpError(502). */
async function pedir(path: string, init: RequestInit): Promise<unknown> {
  const { baseUrl, timeoutMs } = env.notificaciones;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    const abortado = err instanceof DOMException && err.name === "AbortError";
    throw new HttpError(
      502,
      abortado ? `${FUENTE} no respondió a tiempo. Intenta de nuevo.` : `No se pudo conectar con ${FUENTE}.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok) {
    // El proveedor manda { ok:false, error } o { message }. Se usa si es legible.
    const e = data?.error;
    const msg =
      (typeof e === "string" && e) ||
      (e && typeof (e as { message?: unknown }).message === "string" && (e as { message: string }).message) ||
      (typeof data?.message === "string" && data.message) ||
      `${FUENTE} respondió ${res.status}.`;
    throw new HttpError(502, msg as string);
  }

  return data;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return pedir(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as Promise<T>;
}

export function getJson<T>(path: string): Promise<T> {
  return pedir(path, { method: "GET" }) as Promise<T>;
}
