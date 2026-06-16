import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth, requirePermiso } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { corteConstitucionalAdapter } from "./corteConstitucional.client";
import { sincronizarActuaciones } from "./actuacionesSync.service";
import { resolverProveedorActuaciones } from "./proveedores";
import { cifrarCredencial } from "./crypto";
import {
  jurisprudenciaQuerySchema,
  procesoIdParams,
  providerConfigBodySchema,
  providerConfigParams,
  sincronizarQuerySchema,
} from "./integraciones.schemas";

export const integracionRoutes: Router = Router();

/**
 * GET /integraciones/jurisprudencia?q=&limite= — consulta jurisprudencia de la
 * Corte Constitucional (proveedor `api`, datos.gov.co). Devuelve resultados
 * normalizados (JurisprudenciaDTO). Solo lectura; cualquier usuario autenticado.
 */
integracionRoutes.get(
  "/jurisprudencia",
  requireAuth,
  validate({ query: jurisprudenciaQuerySchema }),
  asyncHandler(async (req, res) => {
    const { q, limite } = jurisprudenciaQuerySchema.parse(req.query);
    const resultados = await corteConstitucionalAdapter.buscarJurisprudencia(q, limite);
    res.json({ fuente: corteConstitucionalAdapter.nombre, total: resultados.length, resultados });
  }),
);

/** Resuelve un proceso del despacho (token) o 404 (también si es de otro despacho). */
async function procesoDelDespacho(req: import("express").Request) {
  const empresaId = empresaIdRequerido(req);
  const proceso = await prisma.proceso.findFirst({
    where: { id: req.params.id, empresaId },
    select: { id: true, empresaId: true, radicado: true },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  return proceso;
}

/**
 * POST /integraciones/procesos/:id/sincronizar?forzar= — sincroniza las
 * actuaciones del proceso desde el proveedor habilitado del despacho. On-demand:
 * dentro del TTL se sirve del caché salvo `forzar=true`. Requiere `proceso.editar`.
 */
integracionRoutes.post(
  "/procesos/:id/sincronizar",
  requireAuth,
  requirePermiso("proceso.editar"),
  validate({ params: procesoIdParams, query: sincronizarQuerySchema }),
  asyncHandler(async (req, res) => {
    const proceso = await procesoDelDespacho(req);
    const { forzar } = sincronizarQuerySchema.parse(req.query);

    const proveedor = await resolverProveedorActuaciones(proceso.empresaId);
    if (!proveedor) {
      res.json({ proveedor: null, estado: "SIN_PROVEEDOR", itemsFetched: 0, itemsNew: 0, fromCache: false });
      return;
    }
    const resumen = await sincronizarActuaciones(proceso, proveedor, { forzar });
    res.json({ proveedor: proveedor.nombre, ...resumen });
  }),
);

/**
 * GET /integraciones/procesos/:id/actuaciones — actuaciones ya sincronizadas del
 * proceso (servidas del caché/BD; no llama al proveedor). Requiere `proceso.ver`.
 */
integracionRoutes.get(
  "/procesos/:id/actuaciones",
  requireAuth,
  requirePermiso("proceso.ver"),
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => {
    const proceso = await procesoDelDespacho(req);
    const actuaciones = await prisma.actuacionJudicial.findMany({
      where: { procesoId: proceso.id },
      orderBy: [{ fechaActuacion: "desc" }, { createdAt: "desc" }],
    });
    res.json({ total: actuaciones.length, actuaciones });
  }),
);

/** GET /integraciones/procesos/:id/sync-logs — bitácora de sincronizaciones del
 *  proceso (auditoría). Requiere `proceso.ver`. */
integracionRoutes.get(
  "/procesos/:id/sync-logs",
  requireAuth,
  requirePermiso("proceso.ver"),
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => {
    const proceso = await procesoDelDespacho(req);
    const logs = await prisma.integrationSyncLog.findMany({
      where: { procesoId: proceso.id, empresaId: proceso.empresaId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(logs);
  }),
);

/** Solo el administrador de empresa gestiona la configuración de proveedores. */
function soloAdminEmpresa(req: import("express").Request) {
  if (!req.esAdminEmpresa) throw new HttpError(403, "Solo el administrador de la empresa configura las integraciones");
}

/**
 * GET /integraciones/config — configuración de proveedores del despacho. NUNCA
 * devuelve la credencial; solo `tieneCredencial`. Requiere admin de empresa.
 */
integracionRoutes.get(
  "/config",
  requireAuth,
  asyncHandler(async (req, res) => {
    soloAdminEmpresa(req);
    const empresaId = empresaIdRequerido(req);
    const configs = await prisma.providerConfig.findMany({
      where: { empresaId },
      orderBy: { proveedor: "asc" },
    });
    res.json(configs.map(({ credencialCifrada, ...rest }) => ({ ...rest, tieneCredencial: !!credencialCifrada })));
  }),
);

/**
 * PUT /integraciones/config/:proveedor — upsert de la configuración de un
 * proveedor. La credencial se CIFRA antes de guardar (o se borra con null).
 * Requiere admin de empresa.
 */
integracionRoutes.put(
  "/config/:proveedor",
  requireAuth,
  validate({ params: providerConfigParams, body: providerConfigBodySchema }),
  asyncHandler(async (req, res) => {
    soloAdminEmpresa(req);
    const empresaId = empresaIdRequerido(req);
    const { proveedor } = req.params;
    const body = providerConfigBodySchema.parse(req.body);

    // credencial: undefined = no tocar; null = borrar; string = cifrar.
    const credencialCifrada =
      body.credencial === undefined ? undefined : body.credencial === null ? null : cifrarCredencial(body.credencial);

    const datos = {
      ...(body.habilitado !== undefined ? { habilitado: body.habilitado } : {}),
      ...(credencialCifrada !== undefined ? { credencialCifrada } : {}),
      ...(body.configuracion !== undefined
        ? { configuracion: (body.configuracion ?? Prisma.JsonNull) as Prisma.InputJsonValue }
        : {}),
    };

    const config = await prisma.providerConfig.upsert({
      where: { empresaId_proveedor: { empresaId, proveedor } },
      create: { empresaId, proveedor, habilitado: body.habilitado ?? true, credencialCifrada: credencialCifrada ?? null },
      update: datos,
    });
    const { credencialCifrada: _omit, ...rest } = config;
    void _omit;
    res.json({ ...rest, tieneCredencial: !!config.credencialCifrada });
  }),
);
