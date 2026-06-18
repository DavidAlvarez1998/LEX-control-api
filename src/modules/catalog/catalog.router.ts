// Catálogo de procesos (áreas, tipos, plantillas). Router FINO: HTTP + auth/validate;
// visibilidad híbrida (global + despacho) y autorización viven en catalog.service.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  areaIdParams,
  createAreaSchema,
  createPlantillaSchema,
  createTipoProcesoSchema,
  plantillaIdParams,
  tipoIdParams,
  updateAreaSchema,
  updatePlantillaSchema,
  updateTipoProcesoSchema,
} from "./catalog.schemas";
import * as catalog from "./catalog.service";

export const catalogRoutes: Router = Router();

// --- Áreas de práctica ---

/** GET /catalogo/areas — áreas (solo activas; ADMIN puede pedir todas con ?incluirInactivas). */
catalogRoutes.get(
  "/areas",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await catalog.listAreas(tenant(req), req.query.incluirInactivas != null));
  }),
);

/** POST /catalogo/areas — crea un área (solo ADMIN). */
catalogRoutes.post(
  "/areas",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createAreaSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await catalog.createArea(req.body));
  }),
);

/** PATCH /catalogo/areas/:id — edita un área (solo ADMIN). */
catalogRoutes.patch(
  "/areas/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: areaIdParams, body: updateAreaSchema }),
  asyncHandler(async (req, res) => {
    res.json(await catalog.updateArea(req.params.id, req.body));
  }),
);

/** DELETE /catalogo/areas/:id — elimina un área (solo ADMIN; 409 si tiene tipos). */
catalogRoutes.delete(
  "/areas/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: areaIdParams }),
  asyncHandler(async (req, res) => {
    await catalog.deleteArea(req.params.id);
    res.status(204).end();
  }),
);

// --- Tipos de proceso ---

/** GET /catalogo/tipos-proceso — tipos visibles (globales + propios); filtros ?area, ?jurisdiccion. */
catalogRoutes.get(
  "/tipos-proceso",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await catalog.listTipos(tenant(req), {
      area: req.query.area ? String(req.query.area) : undefined,
      jurisdiccion: req.query.jurisdiccion ? String(req.query.jurisdiccion) : undefined,
    }));
  }),
);

/** GET /catalogo/tipos-proceso/:id — un tipo visible para el despacho. */
catalogRoutes.get(
  "/tipos-proceso/:id",
  requireAuth,
  validate({ params: tipoIdParams }),
  asyncHandler(async (req, res) => {
    res.json(await catalog.getTipo(tenant(req), req.params.id));
  }),
);

/** POST /catalogo/tipos-proceso — crea un tipo (ADMIN global / esAdminEmpresa propio). */
catalogRoutes.post(
  "/tipos-proceso",
  requireAuth,
  validate({ body: createTipoProcesoSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await catalog.createTipo(tenant(req), req.body));
  }),
);

/** PATCH /catalogo/tipos-proceso/:id — edita un tipo y sube su esquemaVersion. */
catalogRoutes.patch(
  "/tipos-proceso/:id",
  requireAuth,
  validate({ params: tipoIdParams, body: updateTipoProcesoSchema }),
  asyncHandler(async (req, res) => {
    res.json(await catalog.updateTipo(tenant(req), req.params.id, req.body));
  }),
);

/** DELETE /catalogo/tipos-proceso/:id — elimina un tipo (409 si está en uso). */
catalogRoutes.delete(
  "/tipos-proceso/:id",
  requireAuth,
  validate({ params: tipoIdParams }),
  asyncHandler(async (req, res) => {
    await catalog.deleteTipo(tenant(req), req.params.id);
    res.status(204).end();
  }),
);

// --- Plantillas de documento (por tipo) ---

/** GET /catalogo/tipos-proceso/:id/plantillas — plantillas de un tipo visible. */
catalogRoutes.get(
  "/tipos-proceso/:id/plantillas",
  requireAuth,
  validate({ params: tipoIdParams }),
  asyncHandler(async (req, res) => {
    res.json(await catalog.listPlantillas(tenant(req), req.params.id));
  }),
);

/** POST /catalogo/tipos-proceso/:id/plantillas — crea una plantilla. */
catalogRoutes.post(
  "/tipos-proceso/:id/plantillas",
  requireAuth,
  validate({ params: tipoIdParams, body: createPlantillaSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await catalog.createPlantilla(tenant(req), req.params.id, req.body));
  }),
);

/** PATCH /catalogo/plantillas/:plantillaId — edita una plantilla. */
catalogRoutes.patch(
  "/plantillas/:plantillaId",
  requireAuth,
  validate({ params: plantillaIdParams, body: updatePlantillaSchema }),
  asyncHandler(async (req, res) => {
    res.json(await catalog.updatePlantilla(tenant(req), req.params.plantillaId, req.body));
  }),
);

/** DELETE /catalogo/plantillas/:plantillaId — elimina una plantilla. */
catalogRoutes.delete(
  "/plantillas/:plantillaId",
  requireAuth,
  validate({ params: plantillaIdParams }),
  asyncHandler(async (req, res) => {
    await catalog.deletePlantilla(tenant(req), req.params.plantillaId);
    res.status(204).end();
  }),
);
