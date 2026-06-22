// Forma de salida del módulo Procesos: detalle (resuelve URLs de documentos),
// item de lista (con semáforo de vencimiento), y nodo de la cadena de caso.
import { construirUrlDocumento } from "../documentos/documentos.client";
import { sumarDiasHabiles } from "./diasHabiles";
import type { EtapaDef } from "./esquema";

/** Resuelve la URL pública de cada documento del detalle. */
export function serializeDetalle<T extends { documentos?: { url: string | null }[] }>(p: T | null): T | null {
  if (!p || !p.documentos) return p;
  return { ...p, documentos: p.documentos.map((d) => ({ ...d, url: construirUrlDocumento(d.url) })) } as T;
}

export type Semaforo = "vencido" | "por_vencer" | "al_dia";

/** Crea la función de semáforo del día (vencido / por_vencer ≤3 días hábiles / al_dia). */
export function crearSemaforo(): (f: Date | null) => Semaforo {
  const ahora = new Date();
  const hoy = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
  const limite = sumarDiasHabiles(hoy, 3);
  return (f) => (!f ? "al_dia" : f < hoy ? "vencido" : f <= limite ? "por_vencer" : "al_dia");
}

type ListRow = {
  id: string; codigoInterno: string; radicado: string | null; titulo: string;
  jurisdiccion: unknown; estado: unknown; prioridad: unknown; proximaAudiencia: Date | null;
  etapaActual: string; fechaLimite: Date | null; responsableId: string | null;
  casoRelacionadoId: string | null; actuacionesNuevas: number;
  tipoProceso: { nombre: string; esJudicial: boolean; grupo: unknown; etapas: unknown; areas: { area: { slug: string } }[] };
  responsable: { nombre: string } | null;
  cliente: { nombre: string } | null;
  _count: { derivados: number };
};

export function toProcesoListItem(t: ListRow, semaforo: (f: Date | null) => Semaforo) {
  return {
    id: t.id, codigoInterno: t.codigoInterno, radicado: t.radicado, titulo: t.titulo,
    tipoProcesoNombre: t.tipoProceso.nombre, esJudicial: t.tipoProceso.esJudicial, grupo: t.tipoProceso.grupo,
    jurisdiccion: t.jurisdiccion, areaSlug: t.tipoProceso.areas[0]?.area.slug ?? null,
    estado: t.estado, prioridad: t.prioridad, proximaAudiencia: t.proximaAudiencia,
    etapaActual: t.etapaActual,
    etapaNombre: ((t.tipoProceso.etapas as unknown as EtapaDef[]) ?? []).find((e) => e.key === t.etapaActual)?.nombre ?? t.etapaActual,
    fechaLimite: t.fechaLimite, semaforo: semaforo(t.fechaLimite),
    responsableId: t.responsableId, responsableNombre: t.responsable?.nombre ?? null,
    clienteNombre: t.cliente?.nombre ?? null, casoRelacionadoId: t.casoRelacionadoId,
    tieneDerivados: t._count.derivados > 0,
    actuacionesNuevas: t.actuacionesNuevas, // P1: novedades del juzgado para la lista
  };
}

type CasoRow = {
  id: string; codigoInterno: string; radicado: string | null; datos: unknown; titulo: string;
  estado: unknown; etapaActual: string; fechaLimite: Date | null; casoRelacionadoId: string | null; createdAt: Date;
  tipoProceso: { nombre: string; esJudicial: boolean; grupo: unknown; etapas: unknown };
};

export function toCasoNodo(p: CasoRow) {
  const etapas = p.tipoProceso.etapas as unknown as EtapaDef[];
  const etapaNombre = etapas?.find((e) => e.key === p.etapaActual)?.nombre ?? p.etapaActual;
  const d = (p.datos ?? {}) as Record<string, unknown>;
  const radicado =
    [p.radicado, d.nroRadicado, d.radicadoIngreso, d.radicadoTutela]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((v) => v.length > 0) ?? null;
  return {
    id: p.id, codigoInterno: p.codigoInterno, radicado, titulo: p.titulo,
    tipoProcesoNombre: p.tipoProceso.nombre, esJudicial: p.tipoProceso.esJudicial, grupo: p.tipoProceso.grupo,
    estado: p.estado, etapaActual: p.etapaActual, etapaNombre, fechaLimite: p.fechaLimite,
    casoRelacionadoId: p.casoRelacionadoId, createdAt: p.createdAt,
  };
}
