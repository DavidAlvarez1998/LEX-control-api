// Venta de la PLATAFORMA: prospectos (embudo) + comisiones. CRM propio de LEX
// Control. Routers FINOS (5 grupos exportados): HTTP + auth/requireRole; la lógica
// (scope por COMERCIAL, transacción de "ganar") vive en ventas.service. Ver openspec
// admin-comercial-ventas.
import { Router } from "express";
import { Rol } from "@prisma/client";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  agendaQuery, cancelarSeguimientoSchema, comisionPatchSchema, completarSeguimientoSchema,
  createProspectoSchema, createSeguimientoSchema, ganarSchema, idParams, perderSchema,
  updateProspectoSchema, updateSeguimientoSchema,
} from "./ventas.schemas";
import * as ventas from "./ventas.service";

export const prospectoRoutes: Router = Router();
export const comisionRoutes: Router = Router();
export const seguimientoRoutes: Router = Router();
export const agendaRoutes: Router = Router();
export const equipoComercialRoutes: Router = Router();

const adminOComercial = [requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL)];
const q = (req: { query: Record<string, unknown> }, k: string) =>
  typeof req.query[k] === "string" ? (req.query[k] as string) : undefined;

// ===================== PROSPECTOS =====================
prospectoRoutes.get("/", ...adminOComercial,
  asyncHandler(async (req, res) => res.json(await ventas.listProspectos(tenant(req), { estado: q(req, "estado"), canal: q(req, "canal"), comercialId: q(req, "comercialId"), sinAsignar: q(req, "sinAsignar") === "1" }))));
prospectoRoutes.post("/", ...adminOComercial, validate({ body: createProspectoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await ventas.createProspecto(tenant(req), req.body))));
prospectoRoutes.get("/:id", ...adminOComercial, validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await ventas.getProspecto(tenant(req), req.params.id))));
prospectoRoutes.patch("/:id", ...adminOComercial, validate({ params: idParams, body: updateProspectoSchema }),
  asyncHandler(async (req, res) => res.json(await ventas.updateProspecto(tenant(req), req.params.id, req.body))));
prospectoRoutes.post("/:id/tomar", ...adminOComercial, validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await ventas.tomarProspecto(tenant(req), req.params.id))));
prospectoRoutes.post("/:id/ganar", ...adminOComercial, validate({ params: idParams, body: ganarSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await ventas.ganarProspecto(tenant(req), req.params.id, req.body))));
prospectoRoutes.post("/:id/perder", ...adminOComercial, validate({ params: idParams, body: perderSchema }),
  asyncHandler(async (req, res) => res.json(await ventas.perderProspecto(tenant(req), req.params.id, req.body))));

// timeline por prospecto
prospectoRoutes.get("/:id/seguimientos", ...adminOComercial, validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await ventas.listSeguimientos(tenant(req), req.params.id))));
prospectoRoutes.post("/:id/seguimientos", ...adminOComercial, validate({ params: idParams, body: createSeguimientoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await ventas.createSeguimiento(tenant(req), req.params.id, req.body))));

// ===================== SEGUIMIENTOS (por id) =====================
seguimientoRoutes.patch("/:id", ...adminOComercial, validate({ params: idParams, body: updateSeguimientoSchema }),
  asyncHandler(async (req, res) => res.json(await ventas.updateSeguimiento(tenant(req), req.params.id, req.body))));
seguimientoRoutes.post("/:id/completar", ...adminOComercial, validate({ params: idParams, body: completarSeguimientoSchema }),
  asyncHandler(async (req, res) => res.json(await ventas.completarSeguimiento(tenant(req), req.params.id, req.body))));
seguimientoRoutes.post("/:id/cancelar", ...adminOComercial, validate({ params: idParams, body: cancelarSeguimientoSchema }),
  asyncHandler(async (req, res) => res.json(await ventas.cancelarSeguimiento(tenant(req), req.params.id, req.body))));
seguimientoRoutes.post("/:id/reabrir", ...adminOComercial, validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await ventas.reabrirSeguimiento(tenant(req), req.params.id))));
seguimientoRoutes.delete("/:id", ...adminOComercial, validate({ params: idParams }),
  asyncHandler(async (req, res) => { await ventas.deleteSeguimiento(tenant(req), req.params.id); res.status(204).end(); }));

// ===================== AGENDA =====================
agendaRoutes.get("/", ...adminOComercial, validate({ query: agendaQuery }),
  asyncHandler(async (req, res) => res.json(await ventas.agenda(tenant(req), agendaQuery.parse(req.query)))));

// ===================== EQUIPO COMERCIAL (ADMIN) =====================
equipoComercialRoutes.get("/", requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => res.json(await ventas.equipoComercial())));

// ===================== COMISIONES =====================
comisionRoutes.get("/", ...adminOComercial,
  asyncHandler(async (req, res) => res.json(await ventas.listComisiones(tenant(req), { estado: q(req, "estado"), comercialId: q(req, "comercialId") }))));
comisionRoutes.patch("/:id", requireAuth, requireRole(Rol.ADMIN), validate({ params: idParams, body: comisionPatchSchema }),
  asyncHandler(async (req, res) => res.json(await ventas.updateComision(req.params.id, req.body))));
