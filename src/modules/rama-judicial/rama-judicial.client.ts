// Cliente de la API de la Rama Judicial (CPNU). Dos pasos: radicado → idProceso
// (Endpoint A) y idProceso → actuaciones paginadas (Endpoint B). Solo consulta
// (lectura). Ver contrato en openspec/changes/rama-judicial-actuaciones/specs.
import { env } from "../../config/env";
import { getJson, getBuffer, esperarEntrePaginas } from "./rama-judicial.http";
import type { ActuacionRama, DetalleRama, DocumentoRama, ProcesoRama } from "./rama-judicial.types";

type ConsultaResp = {
  procesos?: Array<{
    idProceso?: number;
    despacho?: string;
    departamento?: string;
    sujetosProcesales?: string;
    fechaProceso?: string;
    fechaUltimaActuacion?: string;
    esPrivado?: boolean;
  }>;
};

type ActuacionesResp = {
  actuaciones?: ActuacionRama[];
  paginacion?: { cantidadPaginas?: number };
};

const VACIO: ProcesoRama = {
  encontrado: false,
  idProceso: null,
  despacho: null,
  departamento: null,
  sujetosProcesales: null,
  fechaProceso: null,
  fechaUltimaActuacion: null,
  esPrivado: false,
};

/** Radicado (23 dígitos) → datos del proceso. `encontrado=false` si la Rama
 *  devuelve `procesos: []` (no existe / no publicado). */
export async function consultarRadicado(radicado: string): Promise<ProcesoRama> {
  const data = await getJson<ConsultaResp>(
    `/Procesos/Consulta/NumeroRadicacion?numero=${encodeURIComponent(radicado)}&SoloActivos=false&pagina=1`,
  );
  const p = data?.procesos?.[0];
  if (!p) return VACIO;
  return {
    encontrado: true,
    idProceso: p.idProceso ?? null,
    despacho: p.despacho ?? null,
    departamento: p.departamento ?? null,
    sujetosProcesales: p.sujetosProcesales ?? null,
    fechaProceso: p.fechaProceso ?? null,
    fechaUltimaActuacion: p.fechaUltimaActuacion ?? null,
    esPrivado: Boolean(p.esPrivado),
  };
}

/** idProceso → TODAS las actuaciones (recorre todas las páginas, 40 por página). */
export async function obtenerActuaciones(idProceso: number | string): Promise<ActuacionRama[]> {
  const first = await getJson<ActuacionesResp>(`/Proceso/Actuaciones/${idProceso}?pagina=1`);
  const acc: ActuacionRama[] = [...(first?.actuaciones ?? [])];
  const totalPaginas = Math.max(1, first?.paginacion?.cantidadPaginas ?? 1);
  for (let p = 2; p <= totalPaginas; p++) {
    await esperarEntrePaginas();
    const extra = await getJson<ActuacionesResp>(`/Proceso/Actuaciones/${idProceso}?pagina=${p}`);
    if (Array.isArray(extra?.actuaciones)) acc.push(...extra.actuaciones);
  }
  return acc;
}

/** idProceso → detalle del proceso (Endpoint Detalle). */
export async function obtenerDetalle(idProceso: number | string): Promise<DetalleRama | null> {
  const d = await getJson<Record<string, unknown>>(`/Proceso/Detalle/${idProceso}`);
  if (!d || typeof d !== "object") return null;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
  return {
    tipoProceso: s("tipoProceso"), claseProceso: s("claseProceso"), subclaseProceso: s("subclaseProceso"),
    ponente: s("ponente"), recurso: s("recurso"), ubicacion: s("ubicacion"),
    contenidoRadicacion: s("contenidoRadicacion"), ultimaActualizacion: s("ultimaActualizacion"),
  };
}

/** idProceso → lista de documentos del expediente (Endpoint Documentos; array directo). */
export async function obtenerDocumentos(idProceso: number | string): Promise<DocumentoRama[]> {
  const data = await getJson<Array<Record<string, unknown>>>(`/Proceso/Documentos/${idProceso}`);
  if (!Array.isArray(data)) return [];
  return data
    .filter((d) => d.idRegDocumento != null)
    .map((d) => ({
      idRegDocumento: Number(d.idRegDocumento),
      descripcion: (d.descripcion as string) ?? (d.nombre as string) ?? null,
      fechaCarga: (d.fechaCarga as string) ?? null,
      consActuacion: d.consActuacion != null ? Number(d.consActuacion) : null,
    }));
}

/** Descarga el PDF de un documento. Devuelve null si no es PDF o excede el tamaño máximo. */
export async function descargarDocumento(idRegDocumento: number | string): Promise<{ buffer: Buffer; tipo: string } | null> {
  const r = await getBuffer(`/Descarga/Documento/${idRegDocumento}`);
  if (!r.tipo.toLowerCase().includes("application/pdf")) return null;
  if (r.buffer.length > env.ramaJudicial.docMaxBytes) return null;
  return r;
}
