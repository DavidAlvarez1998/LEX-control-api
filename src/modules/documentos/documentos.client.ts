// Cliente de la API documental externa (tecnovapp): sube archivos y reconstruye
// sus URLs públicas. El binario vive en el microservicio; nosotros solo
// persistimos el `path` que devuelve (ver openspec/roadmap-docs/api_documento.odt).
//
// Aislado a propósito: ningún módulo de negocio habla con `fetch` directo; todos
// pasan por aquí. Así cambiar de proveedor (o de DEMO a producción) es solo
// tocar env.documentos, no los módulos.

import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";

/** Datos que el microservicio devuelve tras subir un archivo. */
export type DocumentoSubido = {
  /** Ruta relativa `{EMPRESA}/{CARPETA}/{YYYY}/{MM}/{filename}`. Esto se guarda en BD. */
  path: string;
  /** Nombre final del archivo (con timestamp antepuesto por el servidor). */
  filename: string;
  /** URL pública lista para mostrar/descargar. */
  url: string;
};

export type SubirDocumentoParams = {
  /** Contenido binario del archivo. */
  archivo: Buffer | Uint8Array;
  /** Nombre original del archivo (ej. "contrato.pdf"). */
  nombreArchivo: string;
  /** Identificador del dueño del archivo (cédula, NIT, id externo). */
  documento: string;
  /** RAÍZ {EMPRESA} en tecnovapp = el tenant. Usar `carpetaTenant(empresa)`. */
  raiz: string;
  /** Módulo {CARPETA} (ej. "CONTRATOS", "PROCESOS"). El servidor la crea si no existe. */
  carpeta: string;
  /** Mime type (informativo): "application/pdf", "image/jpeg"… */
  tipo?: string;
};

/** Codifica cada segmento de path para una URL sin romper las barras. */
function segmento(valor: string): string {
  return encodeURIComponent(valor);
}

/**
 * Slug de un nombre para usarlo en una ruta: sin acentos, solo [A-Z0-9-].
 * tecnovapp ya pasa todo a MAYÚSCULA; lo normalizamos aquí para que el `path`
 * guardado sea predecible.
 */
function slugDoc(nombre: string): string {
  const s = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (marcas diacríticas combinantes)
    .replace(/[^a-zA-Z0-9]+/g, "-") // no-alfanumérico → guion
    .replace(/^-+|-+$/g, "") // recorta guiones de los bordes
    .toUpperCase();
  return s || "SIN-NOMBRE";
}

/**
 * RAÍZ {EMPRESA} en tecnovapp para un tenant. Cada despacho es su propia raíz
 * (convención del doc §9.1), namespaceada por `env.documentos.raizPrefijo`:
 *   - empresa = null → "{PREFIJO}-ADMIN"             (plataforma)
 *   - empresa        → "{PREFIJO}-{slug-nombre}-{id}"
 * La entidad concreta (proceso/contrato) NO va aquí: el módulo es la {CARPETA} y
 * el id de la entidad va en `documento` (→ nombre del archivo). El detalle por
 * proceso/contrato vive en la BD, no en la estructura de carpetas.
 */
export function carpetaTenant(empresa: { id: string; nombre: string } | null): string {
  const tenant = empresa ? `${slugDoc(empresa.nombre)}-${empresa.id}` : "ADMIN";
  return `${env.documentos.raizPrefijo}-${tenant}`;
}

/**
 * Reconstruye la URL pública de un archivo a partir del `path` guardado en BD.
 * Tolera que `path` ya sea una URL absoluta o empiece con "/". Devuelve null si
 * no hay path (el registro aún no tiene archivo). Equivalente al helper `buildUrl`
 * del doc, pero leyendo la base desde env.
 */
export function construirUrlDocumento(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path; // ya es URL absoluta
  const base = env.documentos.apiUrl;
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/documentos/${path}`;
}

/**
 * Sube un archivo al microservicio documental y devuelve { path, filename, url }.
 * El `path` es lo único que hay que persistir. Lanza HttpError(502) si el
 * microservicio falla o no responde a tiempo, para que el módulo que llama no
 * confirme una operación a medias.
 */
export async function subirDocumento(
  params: SubirDocumentoParams,
): Promise<DocumentoSubido> {
  const { archivo, nombreArchivo, documento, raiz, carpeta, tipo } = params;

  const url = `${env.documentos.apiUrl}/api/documento/${segmento(raiz)}/${segmento(carpeta)}`;

  const form = new FormData();
  // Blob a partir del Buffer; el tercer arg de append fija el filename.
  form.append("file", new Blob([archivo], { type: tipo }), nombreArchivo);
  form.append("documento", documento);
  if (tipo) form.append("tipo", tipo);

  // Timeout: sin esto, una subida colgada bloquearía la request indefinidamente.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.documentos.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal: controller.signal });
  } catch (err) {
    const abortado = err instanceof DOMException && err.name === "AbortError";
    throw new HttpError(
      502,
      abortado
        ? "El servicio de documentos no respondió a tiempo. Intenta de nuevo."
        : "No se pudo conectar con el servicio de documentos.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new HttpError(502, `El servicio de documentos respondió ${res.status}.`);
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // El doc avisa que distintas versiones nombran distinto el campo de ruta;
  // se leen en orden de preferencia.
  const path =
    (data?.path as string) ??
    (data?.ruta as string) ??
    (data?.location as string) ??
    null;
  if (!path) {
    throw new HttpError(502, "El servicio de documentos no devolvió la ruta del archivo.");
  }

  return {
    path,
    filename: (data?.filename as string) ?? path.split("/").pop() ?? path,
    // El servicio suele devolver `url` RELATIVA ("/documentos/..."); la pasamos
    // por construirUrlDocumento para entregarla siempre ABSOLUTA. Si no vino,
    // se reconstruye desde el path.
    url: construirUrlDocumento((data?.url as string) ?? path)!,
  };
}
