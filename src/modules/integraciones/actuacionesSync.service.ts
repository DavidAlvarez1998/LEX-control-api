// Motor de sincronización de actuaciones (Fase B). Idempotente por
// `hashIdempotencia` = sha256(radicado+fecha+actuacion+anotacion): re-sincronizar
// el mismo evento NO crea duplicados. Cada actuación NUEVA se proyecta al timeline
// (EtapaProceso) y cada corrida deja un IntegrationSyncLog (estado/itemsFetched/
// itemsNew/error). Ver openspec/specs/integraciones-estatales/spec.md.
import { createHash } from "node:crypto";
import type { Proceso } from "@prisma/client";
import { prisma } from "../../index";
import { env } from "../../config/env";
import type { ActuacionDTO, ActuacionesProvider } from "./integraciones.types";

const ETAPA_KEY_ACTUACION = "actuacion-judicial"; // prefijo de timeline; no choca con etapas del flujo

/** Resumen devuelto por una corrida de sincronización. */
export type SyncResumen = {
  estado: "OK" | "ERROR" | "SIN_RADICADO";
  itemsFetched: number;
  itemsNew: number;
  fromCache: boolean;
  error?: string;
};

/** Hash idempotente de una actuación (clave natural del evento judicial). */
function hashActuacion(radicado: string, a: ActuacionDTO): string {
  return createHash("sha256")
    .update(`${radicado}||${a.fecha ?? ""}||${a.actuacion}||${a.anotacion ?? ""}`)
    .digest("hex");
}

/** Fecha parseable a Date o null (el DTO trae string ISO o null). */
function aFecha(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ¿Hay una sincronización OK reciente (dentro del TTL) para este proceso/proveedor?
 *  Si la hay, la consulta on-demand se sirve del caché (no se llama al proveedor). */
async function syncRecienteOk(procesoId: string, proveedor: string): Promise<boolean> {
  const ttlMs = env.integraciones.syncTtlMinutes * 60_000;
  const desde = new Date(Date.now() - ttlMs);
  const ultimo = await prisma.integrationSyncLog.findFirst({
    where: { procesoId, proveedor, estado: "OK", createdAt: { gte: desde } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return !!ultimo;
}

/**
 * Sincroniza las actuaciones de un proceso usando el proveedor dado.
 * - Proceso sin radicado → no-op (log SIN_RADICADO), no se llama al proveedor.
 * - Sin `forzar`, una sincronización OK dentro del TTL se sirve del caché.
 * - Idempotente: solo crea las actuaciones cuyo hash no existe; las proyecta al
 *   timeline y registra el log. NO recalcula `etapaActual` del proceso.
 */
export async function sincronizarActuaciones(
  proceso: Pick<Proceso, "id" | "empresaId" | "radicado">,
  provider: ActuacionesProvider,
  opts: { forzar?: boolean } = {},
): Promise<SyncResumen> {
  // 1) Sin radicado: no hay nada que consultar (spec: "no provider call is made").
  if (!proceso.radicado) {
    await prisma.integrationSyncLog.create({
      data: { empresaId: proceso.empresaId, procesoId: proceso.id, proveedor: provider.nombre, estado: "SIN_RADICADO" },
    });
    return { estado: "SIN_RADICADO", itemsFetched: 0, itemsNew: 0, fromCache: false };
  }

  // 2) Caché TTL: una corrida OK reciente se sirve sin tocar al proveedor.
  if (!opts.forzar && (await syncRecienteOk(proceso.id, provider.nombre))) {
    return { estado: "OK", itemsFetched: 0, itemsNew: 0, fromCache: true };
  }

  // 3) Consulta al proveedor (puede fallar → log ERROR y se propaga el resumen).
  let fetched: ActuacionDTO[];
  try {
    fetched = await provider.fetchActuaciones(proceso.radicado);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Error desconocido del proveedor";
    await prisma.integrationSyncLog.create({
      data: { empresaId: proceso.empresaId, procesoId: proceso.id, proveedor: provider.nombre, estado: "ERROR", error },
    });
    return { estado: "ERROR", itemsFetched: 0, itemsNew: 0, fromCache: false, error };
  }

  // 4) Filtra las que ya existen (idempotencia por hash) y crea solo las nuevas.
  const conHash = fetched.map((a) => ({ a, hash: hashActuacion(proceso.radicado!, a) }));
  const hashes = conHash.map((x) => x.hash);
  const existentes = new Set(
    (
      await prisma.actuacionJudicial.findMany({
        where: { procesoId: proceso.id, hashIdempotencia: { in: hashes } },
        select: { hashIdempotencia: true },
      })
    ).map((r) => r.hashIdempotencia),
  );
  const nuevas = conHash.filter((x) => !existentes.has(x.hash));

  // 5) Crea cada actuación nueva + su entrada de timeline (EtapaProceso), atómico.
  await prisma.$transaction(async (tx) => {
    for (const { a, hash } of nuevas) {
      const etapa = await tx.etapaProceso.create({
        data: {
          procesoId: proceso.id,
          etapaKey: ETAPA_KEY_ACTUACION,
          nota: `[${a.fuente}] ${a.actuacion}${a.anotacion ? ` — ${a.anotacion}` : ""}`,
        },
        select: { id: true },
      });
      await tx.actuacionJudicial.create({
        data: {
          procesoId: proceso.id,
          radicado: proceso.radicado!,
          fechaActuacion: aFecha(a.fecha),
          actuacion: a.actuacion,
          anotacion: a.anotacion,
          fuente: a.fuente,
          hashIdempotencia: hash,
          etapaProcesoId: etapa.id,
        },
      });
    }
  });

  await prisma.integrationSyncLog.create({
    data: {
      empresaId: proceso.empresaId,
      procesoId: proceso.id,
      proveedor: provider.nombre,
      estado: "OK",
      itemsFetched: fetched.length,
      itemsNew: nuevas.length,
    },
  });

  return { estado: "OK", itemsFetched: fetched.length, itemsNew: nuevas.length, fromCache: false };
}
