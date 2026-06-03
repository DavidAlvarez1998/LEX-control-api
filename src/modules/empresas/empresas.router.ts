import { Router } from "express";
import { Prisma, Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  createEmpresaSchema,
  empresaIdParams,
  updateEmpresaSchema,
} from "./empresas.schemas";

export const empresaRoutes: Router = Router();

/** GET /empresas — lista todas las empresas, con conteo de usuarios y servicios. */
empresaRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    const empresas = await prisma.empresa.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { usuarios: true, servicios: true } } },
    });
    res.json(empresas);
  }),
);

/** GET /empresas/:id — una empresa con sus usuarios y servicios asignados. */
empresaRoutes.get(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams }),
  asyncHandler(async (req, res) => {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.params.id },
      include: {
        usuarios: true,
        servicios: { include: { servicio: true } },
      },
    });
    if (!empresa) throw new HttpError(404, "Empresa no encontrada");
    res.json(empresa);
  }),
);

/** POST /empresas — crea una empresa. */
empresaRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createEmpresaSchema }),
  asyncHandler(async (req, res) => {
    try {
      const empresa = await prisma.empresa.create({ data: req.body });
      res.status(201).json(empresa);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new HttpError(409, "Ya existe una empresa con ese RFC/NIT");
      }
      throw err;
    }
  }),
);

/** PATCH /empresas/:id — actualiza una empresa. */
empresaRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams, body: updateEmpresaSchema }),
  asyncHandler(async (req, res) => {
    try {
      const empresa = await prisma.empresa.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.json(empresa);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") {
          throw new HttpError(404, "Empresa no encontrada");
        }
        if (err.code === "P2002") {
          throw new HttpError(409, "Ya existe una empresa con ese RFC/NIT");
        }
      }
      throw err;
    }
  }),
);

/** DELETE /empresas/:id — elimina una empresa (cascada a usuarios y asignaciones). */
empresaRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams }),
  asyncHandler(async (req, res) => {
    try {
      await prisma.empresa.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new HttpError(404, "Empresa no encontrada");
      }
      throw err;
    }
  }),
);
