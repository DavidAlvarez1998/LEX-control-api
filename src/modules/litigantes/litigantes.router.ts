// Litigantes (personas en procesos). Router FINO: HTTP + auth/validate; la lógica
// vive en litigantes.service y el Prisma en litigantes.repository (empresaId forzado).
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  createLitiganteSchema,
  litiganteIdParams,
  updateLitiganteSchema,
} from "./litigantes.schemas";
import * as litigantes from "./litigantes.service";
import { toLitiganteDTO } from "./litigantes.dto";

export const litiganteRoutes: Router = Router();

/** GET /litigantes — litigantes del despacho (búsqueda opcional ?q=). */
litiganteRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = req.query.q ? String(req.query.q) : undefined;
    const lista = await litigantes.listLitigantes(tenant(req), q);
    res.json(lista.map(toLitiganteDTO));
  }),
);

/** GET /litigantes/:id — un litigante del despacho, con sus procesos asociados. */
litiganteRoutes.get(
  "/:id",
  requireAuth,
  validate({ params: litiganteIdParams }),
  asyncHandler(async (req, res) => {
    const litigante = await litigantes.getLitigante(tenant(req), req.params.id);
    res.json(toLitiganteDTO(litigante));
  }),
);

/** POST /litigantes — crea un litigante en el despacho. */
litiganteRoutes.post(
  "/",
  requireAuth,
  validate({ body: createLitiganteSchema }),
  asyncHandler(async (req, res) => {
    const litigante = await litigantes.createLitigante(tenant(req), req.body);
    res.status(201).json(toLitiganteDTO(litigante));
  }),
);

/** PATCH /litigantes/:id — actualiza un litigante del despacho. */
litiganteRoutes.patch(
  "/:id",
  requireAuth,
  validate({ params: litiganteIdParams, body: updateLitiganteSchema }),
  asyncHandler(async (req, res) => {
    const litigante = await litigantes.updateLitigante(tenant(req), req.params.id, req.body);
    res.json(toLitiganteDTO(litigante));
  }),
);

/** DELETE /litigantes/:id — elimina un litigante (si no está en un proceso). */
litiganteRoutes.delete(
  "/:id",
  requireAuth,
  validate({ params: litiganteIdParams }),
  asyncHandler(async (req, res) => {
    await litigantes.deleteLitigante(tenant(req), req.params.id);
    res.status(204).end();
  }),
);
