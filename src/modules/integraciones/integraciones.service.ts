// Casos de uso de Integraciones estatales (tenant-scoped). Jurisprudencia (lectura),
// sincronización on-demand de actuaciones, y configuración de proveedores (credencial
// CIFRADA, nunca devuelta). Sin Express; empresaId vía TenantContext.
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "../../middleware/error";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { corteConstitucionalAdapter } from "./corteConstitucional.client";
import { sincronizarActuaciones } from "./actuacionesSync.service";
import { resolverProveedorActuaciones } from "./proveedores";
import { cifrarCredencial } from "./crypto";
import { IntegracionesRepository } from "./integraciones.repository";
import type { providerConfigBodySchema } from "./integraciones.schemas";

const repo = (t: TenantContext) => new IntegracionesRepository(empresaIdOrThrow(t));

/** Despoja la credencial cifrada y expone solo `tieneCredencial`. */
function toConfigDTO<T extends { credencialCifrada: string | null }>(c: T) {
  const { credencialCifrada, ...rest } = c;
  return { ...rest, tieneCredencial: !!credencialCifrada };
}

async function procesoDelDespacho(t: TenantContext, id: string) {
  const proceso = await repo(t).findProcesoScoped(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  return proceso;
}

export async function buscarJurisprudencia(q: string, limite: number | undefined) {
  const resultados = await corteConstitucionalAdapter.buscarJurisprudencia(q, limite);
  return { fuente: corteConstitucionalAdapter.nombre, total: resultados.length, resultados };
}

export async function sincronizar(t: TenantContext, procesoId: string, forzar: boolean) {
  const proceso = await procesoDelDespacho(t, procesoId);
  const proveedor = await resolverProveedorActuaciones(proceso.empresaId);
  if (!proveedor) return { proveedor: null, estado: "SIN_PROVEEDOR", itemsFetched: 0, itemsNew: 0, fromCache: false };
  const resumen = await sincronizarActuaciones(proceso, proveedor, { forzar });
  return { proveedor: proveedor.nombre, ...resumen };
}

export async function listActuaciones(t: TenantContext, procesoId: string) {
  const proceso = await procesoDelDespacho(t, procesoId);
  const actuaciones = await repo(t).listActuaciones(proceso.id);
  return { total: actuaciones.length, actuaciones };
}

export async function listSyncLogs(t: TenantContext, procesoId: string) {
  const proceso = await procesoDelDespacho(t, procesoId);
  return repo(t).listSyncLogs(proceso.id);
}

/** Solo el administrador de empresa gestiona la configuración de proveedores. */
function soloAdminEmpresa(t: TenantContext) {
  if (!t.esAdminEmpresa) throw new HttpError(403, "Solo el administrador de la empresa configura las integraciones");
}

export async function listConfig(t: TenantContext) {
  soloAdminEmpresa(t);
  return (await repo(t).listProviderConfigs()).map(toConfigDTO);
}

export async function setConfig(t: TenantContext, proveedor: string, body: z.infer<typeof providerConfigBodySchema>) {
  soloAdminEmpresa(t);
  // credencial: undefined = no tocar; null = borrar; string = cifrar.
  const credencialCifrada = body.credencial === undefined ? undefined : body.credencial === null ? null : cifrarCredencial(body.credencial);
  const update = {
    ...(body.habilitado !== undefined ? { habilitado: body.habilitado } : {}),
    ...(credencialCifrada !== undefined ? { credencialCifrada } : {}),
    ...(body.configuracion !== undefined ? { configuracion: (body.configuracion ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
  };
  const config = await repo(t).upsertProviderConfig(
    proveedor,
    { habilitado: body.habilitado ?? true, credencialCifrada: credencialCifrada ?? null },
    update,
  );
  return toConfigDTO(config);
}
