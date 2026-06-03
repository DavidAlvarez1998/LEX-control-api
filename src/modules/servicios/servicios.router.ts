import { Router } from "express";
import { Prisma, Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  createServicioSchema,
  servicioIdParams,
  updateServicioSchema,
} from "./servicios.schemas";

export const servicioRoutes: Router = Router();

/** GET /servicios — lista todos los servicios (más recientes primero). */
servicioRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const servicios = await prisma.servicio.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(servicios);
  }),
);

/** GET /servicios/:id — un servicio por id. */
servicioRoutes.get(
  "/:id",
  requireAuth,
  validate({ params: servicioIdParams }),
  asyncHandler(async (req, res) => {
    const servicio = await prisma.servicio.findUnique({
      where: { id: req.params.id },
    });
    if (!servicio) throw new HttpError(404, "Servicio no encontrado");
    res.json(servicio);
  }),
);

/** POST /servicios — crea un servicio. */
servicioRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createServicioSchema }),
  asyncHandler(async (req, res) => {
    const servicio = await prisma.servicio.create({ data: req.body });
    res.status(201).json(servicio);
  }),
);

/** PATCH /servicios/:id — actualiza campos de un servicio. */
servicioRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: servicioIdParams, body: updateServicioSchema }),
  asyncHandler(async (req, res) => {
    try {
      const servicio = await prisma.servicio.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.json(servicio);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new HttpError(404, "Servicio no encontrado");
      }
      throw err;
    }
  }),
);

/** DELETE /servicios/:id — elimina un servicio (si no está asignado a empresas). */
servicioRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: servicioIdParams }),
  asyncHandler(async (req, res) => {
    try {
      await prisma.servicio.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") {
          throw new HttpError(404, "Servicio no encontrado");
        }
        if (err.code === "P2003" || err.code === "P2014") {
          throw new HttpError(
            409,
            "No se puede eliminar: el servicio está asignado a una o más empresas",
          );
        }
      }
      throw err;
    }
  }),
);
