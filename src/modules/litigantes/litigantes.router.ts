import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  createLitiganteSchema,
  litiganteIdParams,
  updateLitiganteSchema,
} from "./litigantes.schemas";

export const litiganteRoutes: Router = Router();

/** GET /litigantes — litigantes del despacho (búsqueda opcional ?q=). */
litiganteRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const q = req.query.q ? String(req.query.q) : undefined;
    const litigantes = await prisma.litigante.findMany({
      where: {
        empresaId,
        ...(q ? { nombre: { contains: q } } : {}),
      },
      orderBy: { nombre: "asc" },
    });
    res.json(litigantes);
  }),
);

/** GET /litigantes/:id — un litigante del despacho, con sus procesos asociados. */
litiganteRoutes.get(
  "/:id",
  requireAuth,
  validate({ params: litiganteIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const litigante = await prisma.litigante.findFirst({
      where: { id: req.params.id, empresaId },
      include: { partes: { include: { proceso: { select: { id: true, titulo: true, codigoInterno: true } } } } },
    });
    if (!litigante) throw new HttpError(404, "Litigante no encontrado");
    res.json(litigante);
  }),
);

/** POST /litigantes — crea un litigante en el despacho. */
litiganteRoutes.post(
  "/",
  requireAuth,
  validate({ body: createLitiganteSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const litigante = await prisma.litigante.create({
      data: { ...req.body, empresaId },
    });
    res.status(201).json(litigante);
  }),
);

/** PATCH /litigantes/:id — actualiza un litigante del despacho. */
litiganteRoutes.patch(
  "/:id",
  requireAuth,
  validate({ params: litiganteIdParams, body: updateLitiganteSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.litigante.updateMany({
      where: { id: req.params.id, empresaId },
      data: req.body,
    });
    if (count === 0) throw new HttpError(404, "Litigante no encontrado");
    const litigante = await prisma.litigante.findUnique({ where: { id: req.params.id } });
    res.json(litigante);
  }),
);

/** DELETE /litigantes/:id — elimina un litigante (si no está en un proceso). */
litiganteRoutes.delete(
  "/:id",
  requireAuth,
  validate({ params: litiganteIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const litigante = await prisma.litigante.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true },
    });
    if (!litigante) throw new HttpError(404, "Litigante no encontrado");
    try {
      await prisma.litigante.delete({ where: { id: litigante.id } });
      res.status(204).end();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2003" || err.code === "P2014")
      ) {
        throw new HttpError(409, "No se puede eliminar: el litigante está vinculado a un proceso");
      }
      throw err;
    }
  }),
);
