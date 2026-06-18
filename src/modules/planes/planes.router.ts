// Administración de PLANES (portal ADMIN). Router FINO: HTTP + auth/RBAC; la lógica
// (incl. transacciones) vive en planes.service y los datos en planes.repository.
// Solo ADMIN (GET /planes también COMERCIAL). Ver openspec planes-entitlements.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  asignarPlanSchema, createPlanSchema, planIdParams, updatePlanSchema,
} from "./planes.schemas";
import * as planes from "./planes.service";

export const planRoutes: Router = Router();

/** GET /planes/modulos — catálogo de módulos (para el editor). */
planRoutes.get(
  "/modulos",
  requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    res.json(await planes.listModulos());
  }),
);

/** GET /planes/suscripciones — despachos con su plan actual. */
planRoutes.get(
  "/suscripciones",
  requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    res.json(await planes.listSuscripciones());
  }),
);

/** PUT /planes/suscripciones/:empresaId — asigna/cambia el plan de un despacho. */
planRoutes.put(
  "/suscripciones/:empresaId",
  requireAuth, requireRole(Rol.ADMIN),
  validate({ body: asignarPlanSchema }),
  asyncHandler(async (req, res) => {
    res.json(await planes.asignarPlan(req.params.empresaId, req.body.planId));
  }),
);

/** GET /planes — catálogo de planes con sus módulos y cupos (ADMIN + COMERCIAL). */
planRoutes.get(
  "/",
  requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  asyncHandler(async (_req, res) => {
    res.json(await planes.listPlanes());
  }),
);

/** POST /planes — crea un plan. */
planRoutes.post(
  "/",
  requireAuth, requireRole(Rol.ADMIN),
  validate({ body: createPlanSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await planes.createPlan(req.body));
  }),
);

/** PATCH /planes/:id — edita un plan (módulos/cupos: si vienen, reemplazan el set). */
planRoutes.patch(
  "/:id",
  requireAuth, requireRole(Rol.ADMIN),
  validate({ params: planIdParams, body: updatePlanSchema }),
  asyncHandler(async (req, res) => {
    res.json(await planes.updatePlan(req.params.id, req.body));
  }),
);
