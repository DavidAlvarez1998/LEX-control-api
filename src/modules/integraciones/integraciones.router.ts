// Integraciones estatales. Router FINO: HTTP + auth/requirePermiso/validate; la
// lógica (jurisprudencia, sync, config cifrada) vive en integraciones.service.
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requirePermiso } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  jurisprudenciaQuerySchema, procesoIdParams, providerConfigBodySchema,
  providerConfigParams, sincronizarQuerySchema,
} from "./integraciones.schemas";
import * as integraciones from "./integraciones.service";

export const integracionRoutes: Router = Router();

/** GET /integraciones/jurisprudencia?q=&limite= — jurisprudencia de la Corte Constitucional. */
integracionRoutes.get(
  "/jurisprudencia",
  requireAuth,
  validate({ query: jurisprudenciaQuerySchema }),
  asyncHandler(async (req, res) => {
    const { q, limite } = jurisprudenciaQuerySchema.parse(req.query);
    res.json(await integraciones.buscarJurisprudencia(q, limite));
  }),
);

/** POST /integraciones/procesos/:id/sincronizar?forzar= — sincroniza actuaciones. */
integracionRoutes.post(
  "/procesos/:id/sincronizar",
  requireAuth,
  requirePermiso("proceso.editar"),
  validate({ params: procesoIdParams, query: sincronizarQuerySchema }),
  asyncHandler(async (req, res) => {
    const { forzar } = sincronizarQuerySchema.parse(req.query);
    res.json(await integraciones.sincronizar(tenant(req), req.params.id, !!forzar));
  }),
);

/** GET /integraciones/procesos/:id/actuaciones — actuaciones sincronizadas (caché/BD). */
integracionRoutes.get(
  "/procesos/:id/actuaciones",
  requireAuth,
  requirePermiso("proceso.ver"),
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await integraciones.listActuaciones(tenant(req), req.params.id))),
);

/** GET /integraciones/procesos/:id/sync-logs — bitácora de sincronizaciones. */
integracionRoutes.get(
  "/procesos/:id/sync-logs",
  requireAuth,
  requirePermiso("proceso.ver"),
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await integraciones.listSyncLogs(tenant(req), req.params.id))),
);

/** GET /integraciones/config — config de proveedores del despacho (sin credencial). */
integracionRoutes.get(
  "/config",
  requireAuth,
  asyncHandler(async (req, res) => res.json(await integraciones.listConfig(tenant(req)))),
);

/** PUT /integraciones/config/:proveedor — upsert de config (credencial CIFRADA). */
integracionRoutes.put(
  "/config/:proveedor",
  requireAuth,
  validate({ params: providerConfigParams, body: providerConfigBodySchema }),
  asyncHandler(async (req, res) => res.json(await integraciones.setConfig(tenant(req), req.params.proveedor, req.body))),
);
