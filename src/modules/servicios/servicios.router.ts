// Catálogo GLOBAL de servicios. Router FINO: HTTP + auth/RBAC (ADMIN para escribir);
// lógica en servicios.service, datos en servicios.repository.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  createServicioSchema,
  servicioIdParams,
  updateServicioSchema,
} from "./servicios.schemas";
import * as servicios from "./servicios.service";
import { toServicioDTO } from "./servicios.dto";

export const servicioRoutes: Router = Router();

/** GET /servicios — lista todos los servicios (más recientes primero). */
servicioRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const lista = await servicios.listServicios();
    res.json(lista.map(toServicioDTO));
  }),
);

/** GET /servicios/:id — un servicio por id. */
servicioRoutes.get(
  "/:id",
  requireAuth,
  validate({ params: servicioIdParams }),
  asyncHandler(async (req, res) => {
    const servicio = await servicios.getServicio(req.params.id);
    res.json(toServicioDTO(servicio));
  }),
);

/** POST /servicios — crea un servicio (ADMIN). */
servicioRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createServicioSchema }),
  asyncHandler(async (req, res) => {
    const servicio = await servicios.createServicio(req.body);
    res.status(201).json(toServicioDTO(servicio));
  }),
);

/** PATCH /servicios/:id — actualiza campos de un servicio (ADMIN). */
servicioRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: servicioIdParams, body: updateServicioSchema }),
  asyncHandler(async (req, res) => {
    const servicio = await servicios.updateServicio(req.params.id, req.body);
    res.json(toServicioDTO(servicio));
  }),
);

/** DELETE /servicios/:id — elimina un servicio (si no está asignado a empresas). */
servicioRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: servicioIdParams }),
  asyncHandler(async (req, res) => {
    await servicios.deleteServicio(req.params.id);
    res.status(204).end();
  }),
);
