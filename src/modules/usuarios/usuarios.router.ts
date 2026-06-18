// Usuarios (gestión ADMIN de plataforma). Router FINO: HTTP + auth/RBAC (ADMIN);
// la lógica (cupos, roles, activación, revocación) vive en usuarios.service.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  createUsuarioSchema,
  updateUsuarioSchema,
  usuarioIdParams,
} from "./usuarios.schemas";
import * as usuarios from "./usuarios.service";
import { toUsuarioListDTO } from "./usuarios.dto";

export const usuarioRoutes: Router = Router();

/** GET /usuarios — lista usuarios (opcional ?empresaId), con estado derivado. */
usuarioRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  asyncHandler(async (req, res) => {
    const empresaId = typeof req.query.empresaId === "string" ? req.query.empresaId : undefined;
    const lista = await usuarios.listUsuarios(empresaId);
    res.json(lista.map(toUsuarioListDTO));
  }),
);

/** POST /usuarios — crea el usuario y devuelve el link de activación. */
usuarioRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createUsuarioSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await usuarios.createUsuario(req.body));
  }),
);

/** PATCH /usuarios/:id — actualiza nombre, rol, activo, esAdminEmpresa. */
usuarioRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: usuarioIdParams, body: updateUsuarioSchema }),
  asyncHandler(async (req, res) => {
    res.json(await usuarios.updateUsuario(req.params.id, req.body));
  }),
);

/** POST /usuarios/:id/reset-password — regenera el link de activación. */
usuarioRoutes.post(
  "/:id/reset-password",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: usuarioIdParams }),
  asyncHandler(async (req, res) => {
    res.json(await usuarios.resetPassword(req.params.id));
  }),
);

/** DELETE /usuarios/:id — elimina el usuario de forma permanente (hard delete). */
usuarioRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: usuarioIdParams }),
  asyncHandler(async (req, res) => {
    await usuarios.deleteUsuario(req.params.id, req.user?.sub);
    res.status(204).end();
  }),
);
