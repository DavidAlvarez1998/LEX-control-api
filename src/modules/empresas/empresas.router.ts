// Empresas (gestión ADMIN de plataforma). Router FINO: HTTP + auth/RBAC (ADMIN);
// la lógica (incl. transacciones y replace-set de servicios) vive en empresas.service
// y los datos en empresas.repository.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  createEmpresaSchema,
  empresaIdParams,
  updateEmpresaSchema,
} from "./empresas.schemas";
import * as empresas from "./empresas.service";
import { toEmpresaDTO } from "./empresas.dto";

export const empresaRoutes: Router = Router();

/** GET /empresas — lista todas las empresas, con conteo de usuarios y servicios. */
empresaRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    const lista = await empresas.listEmpresas();
    res.json(lista.map(toEmpresaDTO));
  }),
);

/** GET /empresas/:id — una empresa con sus usuarios y servicios asignados. */
empresaRoutes.get(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams }),
  asyncHandler(async (req, res) => {
    const empresa = await empresas.getEmpresa(req.params.id);
    res.json(toEmpresaDTO(empresa));
  }),
);

/** POST /empresas — crea una empresa. */
empresaRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createEmpresaSchema }),
  asyncHandler(async (req, res) => {
    const empresa = await empresas.createEmpresa(req.body);
    res.status(201).json(toEmpresaDTO(empresa));
  }),
);

/** PATCH /empresas/:id — actualiza una empresa. */
empresaRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams, body: updateEmpresaSchema }),
  asyncHandler(async (req, res) => {
    const empresa = await empresas.updateEmpresa(req.params.id, req.body);
    res.json(toEmpresaDTO(empresa));
  }),
);

/** DELETE /empresas/:id — elimina una empresa (cascada a usuarios y asignaciones). */
empresaRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams }),
  asyncHandler(async (req, res) => {
    await empresas.deleteEmpresa(req.params.id);
    res.status(204).end();
  }),
);
