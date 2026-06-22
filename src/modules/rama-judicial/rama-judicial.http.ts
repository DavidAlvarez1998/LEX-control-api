// Transporte HTTP de la API de la Rama Judicial (CPNU). ÚNICO lugar del módulo que
// hace `fetch`: el client solo arma paths y normaliza. Fija el User-Agent de
// navegador (sin él la Rama puede responder 403) y traduce fallos a HttpError(502).
import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";

const FUENTE = "la Rama Judicial";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pedirUnaVez<T>(path: string): Promise<T> {
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

/** GET con reintentos + backoff exponencial. La Rama bloquea (403/429) si la golpeas
 *  rápido; el transporte mapea esos fallos a 502 y aquí reintentamos. En tests no
 *  reintenta (intentos=1) para no introducir esperas ni cambiar el contrato. */
export async function getJson<T>(path: string): Promise<T> {
  const { retryAttempts, retryInitialMs, retryMaxMs } = env.ramaJudicial;
  const intentos = process.env.NODE_ENV === "test" ? 1 : Math.max(1, retryAttempts);

  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await pedirUnaVez<T>(path);
    } catch (err) {
      ultimo = err;
      if (i === intentos) break;
      await dormir(Math.min(retryMaxMs, retryInitialMs * 2 ** (i - 1)));
    }
  }
  throw ultimo;
}

async function pedirBufferUnaVez(path: string): Promise<{ buffer: Buffer; tipo: string }> {
  const { baseUrl, timeoutMs, userAgent } = env.ramaJudicial;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { method: "GET", headers: { "User-Agent": userAgent }, signal: controller.signal });
  } catch (err) {
    const abortado = err instanceof DOMException && err.name === "AbortError";
    throw new HttpError(502, abortado ? `${FUENTE} no respondió a tiempo. Intenta de nuevo.` : `No se pudo conectar con ${FUENTE}.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new HttpError(502, `${FUENTE} respondió ${res.status}. Intenta más tarde.`);
  return { buffer: Buffer.from(await res.arrayBuffer()), tipo: res.headers.get("content-type") ?? "" };
}

/** GET binario (descarga de documentos) con los mismos reintentos que getJson. */
export async function getBuffer(path: string): Promise<{ buffer: Buffer; tipo: string }> {
  const { retryAttempts, retryInitialMs, retryMaxMs } = env.ramaJudicial;
  const intentos = process.env.NODE_ENV === "test" ? 1 : Math.max(1, retryAttempts);
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await pedirBufferUnaVez(path);
    } catch (err) {
      ultimo = err;
      if (i === intentos) break;
      await dormir(Math.min(retryMaxMs, retryInitialMs * 2 ** (i - 1)));
    }
  }
  throw ultimo;
}

/** Espera entre páginas para no gatillar el rate-limit (se omite en tests). */
export function esperarEntrePaginas(): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  return new Promise((r) => setTimeout(r, env.ramaJudicial.delayPaginasMs));
}
