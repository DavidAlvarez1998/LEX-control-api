// Transporte HTTP de la API de la Rama Judicial (CPNU). ÚNICO lugar del módulo que
// hace `fetch`: el client solo arma paths y normaliza. Fija el User-Agent de
// navegador (sin él la Rama puede responder 403) y traduce fallos a HttpError(502).
import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";

const FUENTE = "la Rama Judicial";

export async function getJson<T>(path: string): Promise<T> {
  const { baseUrl, timeoutMs, userAgent } = env.ramaJudicial;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    const abortado = err instanceof DOMException && err.name === "AbortError";
    throw new HttpError(
      502,
      abortado ? `${FUENTE} no respondió a tiempo. Intenta de nuevo.` : `No se pudo conectar con ${FUENTE}.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 403/429 = rate-limiting de la Rama; 5xx = su servidor. Todo → 502 para el caller.
    throw new HttpError(502, `${FUENTE} respondió ${res.status}. Intenta más tarde.`);
  }

  return (await res.json().catch(() => null)) as T;
}

/** Espera entre páginas para no gatillar el rate-limit (se omite en tests). */
export function esperarEntrePaginas(): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  return new Promise((r) => setTimeout(r, env.ramaJudicial.delayPaginasMs));
}
