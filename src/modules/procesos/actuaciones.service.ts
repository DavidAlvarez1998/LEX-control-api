// Actuaciones de la Rama Judicial (CPNU) para un Proceso. Casos de uso:
//  - validarRadicado: ¿existe el radicado en la Rama? (feedback al pegarlo).
//  - sincronizarActuaciones: descarga e inserta SOLO las nuevas (idempotente), cachea
//    idProcesoRama y autollena datos.ultimaActuacion (la usa la plantilla memorial).
//  - listarActuaciones: las guardadas, más reciente primero.
// Tenant-scoped: el proceso debe ser de la empresa del solicitante. Ver
// openspec/changes/rama-judicial-actuaciones.
import { createHash } from "crypto";
import { HttpError } from "../../middleware/error";
import { logger } from "../../shared/logger";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { consultarRadicado, obtenerActuaciones, type ActuacionRama } from "../rama-judicial";

/** Deja solo dígitos y exige 23 (radicado CPNU). Devuelve null si no cumple. */
export function normalizarRadicado(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\D/g, "");
  return v.length === 23 ? v : null;
}

/** Hash estable anti-duplicado (la CPNU no da id por actuación). */
function huella(a: ActuacionRama): string {
  return createHash("sha256")
    .update(`${a.fechaActuacion ?? ""}|${a.actuacion ?? ""}|${a.anotacion ?? ""}`)
    .digest("hex");
}

function parseFecha(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Endpoint A: ¿existe el radicado? Para feedback inmediato al pegarlo. */
export async function validarRadicado(radicado: string) {
  const norm = normalizarRadicado(radicado);
  if (!norm) throw new HttpError(400, "El radicado debe tener 23 dígitos");
  return consultarRadicado(norm);
}

async function cargarProcesoScoped(t: TenantContext, procesoId: string) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: { id: true, radicado: true, idProcesoRama: true, datos: true },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  return proceso;
}

/** Sincroniza las actuaciones del proceso desde la Rama. Inserta solo las nuevas. */
export async function sincronizarActuaciones(t: TenantContext, procesoId: string) {
  const proceso = await cargarProcesoScoped(t, procesoId);
  const radicado = normalizarRadicado(proceso.radicado);
  if (!radicado) throw new HttpError(400, "El proceso no tiene un radicado válido de 23 dígitos");

  // idProceso: usar el cacheado o resolverlo vía Endpoint A.
  let idProceso = proceso.idProcesoRama;
  if (!idProceso) {
    const info = await consultarRadicado(radicado);
    if (info.esPrivado) return { encontrado: false, reservado: true, nuevas: 0, total: 0 };
    if (!info.encontrado || info.idProceso == null) {
      return { encontrado: false, reservado: false, nuevas: 0, total: 0 };
    }
    idProceso = String(info.idProceso);
  }

  const actuaciones = await obtenerActuaciones(idProceso);
  const items = actuaciones.map((a) => ({ a, h: huella(a) }));

  const existentes = new Set(
    (await prisma.actuacionProceso.findMany({ where: { procesoId }, select: { huella: true } })).map((x) => x.huella),
  );
  const nuevas = items.filter(({ h }) => !existentes.has(h));

  if (nuevas.length) {
    await prisma.actuacionProceso.createMany({
      data: nuevas.map(({ a, h }) => ({
        procesoId,
        fechaActuacion: parseFecha(a.fechaActuacion) ?? new Date(0),
        actuacion: a.actuacion,
        anotacion: a.anotacion ?? null,
        fechaInicial: parseFecha(a.fechaInicial),
        fechaFinal: parseFecha(a.fechaFinal),
        fechaRegistro: parseFecha(a.fechaRegistro),
        huella: h,
      })),
      skipDuplicates: true,
    });
  }

  // Cachear idProcesoRama + autollenar datos.ultimaActuacion (la más reciente por fecha).
  const masReciente = [...actuaciones].sort(
    (x, y) => (parseFecha(y.fechaActuacion)?.getTime() ?? 0) - (parseFecha(x.fechaActuacion)?.getTime() ?? 0),
  )[0];
  const datos = (proceso.datos ?? {}) as Record<string, unknown>;
  await prisma.proceso.update({
    where: { id: procesoId },
    data: {
      idProcesoRama: idProceso,
      ...(masReciente ? { datos: { ...datos, ultimaActuacion: masReciente.actuacion } } : {}),
    },
  });

  logger.info("actuaciones sincronizadas", { procesoId, nuevas: nuevas.length, total: items.length });
  return { encontrado: true, reservado: false, nuevas: nuevas.length, total: items.length };
}

/** Actuaciones guardadas del proceso (más reciente primero). */
export async function listarActuaciones(t: TenantContext, procesoId: string) {
  await cargarProcesoScoped(t, procesoId);
  return prisma.actuacionProceso.findMany({
    where: { procesoId },
    orderBy: { fechaActuacion: "desc" },
    select: {
      id: true,
      fechaActuacion: true,
      actuacion: true,
      anotacion: true,
      fechaRegistro: true,
      createdAt: true,
    },
  });
}
