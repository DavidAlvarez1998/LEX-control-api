// Mi Empresa (portal del cliente): la empresa propia + gestión del equipo por el
// admin de empresa. Router FINO: HTTP + guards (USUARIO + esAdminEmpresa); la lógica
// (cupos, roles, transacciones) vive en mi-empresa.service. empresaId del token.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireEmpresaAdmin, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  createMiembroSchema,
  miembroIdParams,
  updateMiembroSchema,
  updatePerfilSchema,
} from "./mi-empresa.schemas";
import * as miEmpresa from "./mi-empresa.service";
import { toMiembroDTO } from "./mi-empresa.dto";

export const miEmpresaRoutes: Router = Router();

/** GET /mi-empresa — la empresa del usuario (con servicios solo si es admin de empresa). */
miEmpresaRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.USUARIO),
  asyncHandler(async (req, res) => {
    res.json(await miEmpresa.getMiEmpresa(tenant(req)));
  }),
);

/** GET /mi-empresa/perfil — perfil profesional propio (cualquier USUARIO). */
miEmpresaRoutes.get(
  "/perfil",
  requireAuth,
  requireRole(Rol.USUARIO),
  asyncHandler(async (req, res) => {
    res.json(await miEmpresa.getPerfil(tenant(req)));
  }),
);

/** PATCH /mi-empresa/perfil — auto-edición (cédula, tarjeta profesional, teléfono). */
miEmpresaRoutes.patch(
  "/perfil",
  requireAuth,
  requireRole(Rol.USUARIO),
  validate({ body: updatePerfilSchema }),
  asyncHandler(async (req, res) => {
    res.json(await miEmpresa.updatePerfil(tenant(req), req.body));
  }),
);

/** Guardas comunes de los endpoints de equipo (admin de la propia empresa). */
const equipoGuards = [requireAuth, requireRole(Rol.USUARIO), requireEmpresaAdmin];

/** GET /mi-empresa/usuarios — equipo de la propia empresa (estado + roles). */
miEmpresaRoutes.get(
  "/usuarios",
  ...equipoGuards,
  asyncHandler(async (req, res) => {
    const lista = await miEmpresa.listEquipo(tenant(req));
    res.json(lista.map(toMiembroDTO));
  }),
);

/** GET /mi-empresa/cupos — cap/usados por rol según el plan. */
miEmpresaRoutes.get(
  "/cupos",
  ...equipoGuards,
  asyncHandler(async (req, res) => {
    res.json(await miEmpresa.getCupos(tenant(req)));
  }),
);

/** POST /mi-empresa/usuarios — crea un miembro + roles; devuelve link de activación. */
miEmpresaRoutes.post(
  "/usuarios",
  ...equipoGuards,
  validate({ body: createMiembroSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await miEmpresa.createMiembro(tenant(req), req.body));
  }),
);

/** PATCH /mi-empresa/usuarios/:id — activa/desactiva y/o reconcilia roles. */
miEmpresaRoutes.patch(
  "/usuarios/:id",
  ...equipoGuards,
  validate({ params: miembroIdParams, body: updateMiembroSchema }),
  asyncHandler(async (req, res) => {
    res.json(await miEmpresa.updateMiembro(tenant(req), req.params.id, req.body));
  }),
);

/** POST /mi-empresa/usuarios/:id/activation — regenera el link de activación (reenvío). */
miEmpresaRoutes.post(
  "/usuarios/:id/activation",
  ...equipoGuards,
  validate({ params: miembroIdParams }),
  asyncHandler(async (req, res) => {
    res.json(await miEmpresa.resendActivation(tenant(req), req.params.id));
  }),
);
