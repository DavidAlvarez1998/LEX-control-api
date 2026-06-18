// Módulo COMERCIAL (embudo). Router FINO: HTTP + auth/requirePermiso/validate; la
// lógica (fases, cobro, alertas, pipeline, el puente solicitud→proceso, comisiones)
// vive en comercial.service y las queries en comercial.repository (empresaId del token).
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requirePermiso } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  agendaQuery, asignarSolicitudSchema, cancelarSeguimientoSchema, completarSeguimientoSchema,
  configCobroSchema, createComisionSchema, createContratoSchema, createCotizacionSchema,
  createSeguimientoSchema, createSolicitudSchema, idParams, moverFaseSchema, rechazarSolicitudSchema,
  updateComisionSchema, updateContratoSchema, updateCotizacionSchema, updateSeguimientoSchema,
} from "./comercial.schemas";
import * as comercial from "./comercial.service";

export const comercialRoutes: Router = Router();
const q = (req: { query: Record<string, unknown> }, k: string) =>
  typeof req.query[k] === "string" ? (req.query[k] as string) : undefined;
const mios = (req: { query: Record<string, unknown> }) => req.query.mios === "true" || req.query.mios === "1";

// ===================== SEGUIMIENTO =====================
comercialRoutes.get("/seguimientos", requireAuth,
  asyncHandler(async (req, res) => res.json(await comercial.listSeguimientos(tenant(req), q(req, "clienteId")))));
comercialRoutes.post("/seguimientos", requireAuth, validate({ body: createSeguimientoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.createSeguimiento(tenant(req), req.body))));
comercialRoutes.patch("/seguimientos/:id", requireAuth, validate({ params: idParams, body: updateSeguimientoSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.updateSeguimiento(tenant(req), req.params.id, req.body))));

// ===================== AGENDA =====================
comercialRoutes.get("/agenda", requireAuth, validate({ query: agendaQuery }),
  asyncHandler(async (req, res) => res.json(await comercial.agenda(tenant(req), agendaQuery.parse(req.query)))));
comercialRoutes.post("/seguimientos/:id/completar", requireAuth, validate({ params: idParams, body: completarSeguimientoSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.completarSeguimiento(tenant(req), req.params.id, req.body))));
comercialRoutes.post("/seguimientos/:id/cancelar", requireAuth, validate({ params: idParams, body: cancelarSeguimientoSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.cancelarSeguimiento(tenant(req), req.params.id, req.body))));
comercialRoutes.post("/seguimientos/:id/reabrir", requireAuth, validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await comercial.reabrirSeguimiento(tenant(req), req.params.id))));

// ===================== FASES =====================
comercialRoutes.get("/clientes/:id/fases", requireAuth, requirePermiso("comercial.fase.ver"), validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await comercial.listFases(tenant(req), req.params.id))));
comercialRoutes.post("/clientes/:id/fase", requireAuth, requirePermiso("comercial.fase.mover"), validate({ params: idParams, body: moverFaseSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.moverFase(tenant(req), req.params.id, req.body))));

// ===================== COTIZACIÓN =====================
comercialRoutes.get("/cotizaciones", requireAuth, requirePermiso("comercial.cotizacion.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.listCotizaciones(tenant(req), q(req, "clienteId")))));
comercialRoutes.post("/cotizaciones", requireAuth, requirePermiso("comercial.cotizacion.crear"), validate({ body: createCotizacionSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.createCotizacion(tenant(req), req.body))));
comercialRoutes.patch("/cotizaciones/:id", requireAuth, requirePermiso("comercial.cotizacion.editar"), validate({ params: idParams, body: updateCotizacionSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.updateCotizacion(tenant(req), req.params.id, req.body))));

// ===================== CONTRATO + COBRO =====================
comercialRoutes.get("/contratos", requireAuth, requirePermiso("comercial.contrato.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.listContratos(tenant(req), q(req, "clienteId")))));
comercialRoutes.post("/contratos", requireAuth, requirePermiso("comercial.contrato.crear"), validate({ body: createContratoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.createContrato(tenant(req), req.body))));
comercialRoutes.patch("/contratos/:id", requireAuth, requirePermiso("comercial.contrato.editar"), validate({ params: idParams, body: updateContratoSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.updateContrato(tenant(req), req.params.id, req.body))));
comercialRoutes.get("/contratos/:id/cobro", requireAuth, requirePermiso("comercial.cobro.ver"), validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await comercial.getCobro(tenant(req), req.params.id))));
comercialRoutes.put("/contratos/:id/cobro", requireAuth, requirePermiso("comercial.cobro.configurar"), validate({ params: idParams, body: configCobroSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.setCobro(tenant(req), req.params.id, req.body))));

// ===================== ALERTAS / PIPELINE / HOY =====================
comercialRoutes.get("/alertas", requireAuth, requirePermiso("comercial.alertas.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.alertas(tenant(req)))));
comercialRoutes.get("/pipeline", requireAuth, requirePermiso("cliente.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.pipeline(tenant(req), mios(req)))));
comercialRoutes.get("/hoy", requireAuth, requirePermiso("cliente.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.hoy(tenant(req), mios(req)))));

// ===================== SOLICITUDES (puente comercial→legal) =====================
comercialRoutes.post("/solicitudes", requireAuth, requirePermiso("comercial.solicitud.crear"), validate({ body: createSolicitudSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.createSolicitud(tenant(req), req.body))));
comercialRoutes.get("/solicitudes", requireAuth, requirePermiso("comercial.solicitud.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.listSolicitudes(tenant(req), q(req, "estado")))));
comercialRoutes.post("/solicitudes/:id/asignar", requireAuth, requirePermiso("comercial.solicitud.asignar"), validate({ params: idParams, body: asignarSolicitudSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.asignarSolicitud(tenant(req), req.params.id, req.body))));
comercialRoutes.post("/solicitudes/:id/rechazar", requireAuth, requirePermiso("comercial.solicitud.rechazar"), validate({ params: idParams, body: rechazarSolicitudSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.rechazarSolicitud(tenant(req), req.params.id, req.body))));

// ===================== CARTERA RESUMEN =====================
comercialRoutes.get("/clientes/:id/cartera", requireAuth, requirePermiso("comercial.cobro.ver"), validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await comercial.carteraCliente(tenant(req), req.params.id))));

// ===================== COMISIONES =====================
comercialRoutes.get("/comisiones", requireAuth, requirePermiso("comercial.comision.ver"),
  asyncHandler(async (req, res) => res.json(await comercial.listComisiones(tenant(req), { clienteId: q(req, "clienteId"), comercialId: q(req, "comercialId"), estado: q(req, "estado") }))));
comercialRoutes.post("/comisiones", requireAuth, requirePermiso("comercial.comision.crear"), validate({ body: createComisionSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await comercial.createComision(tenant(req), req.body))));
comercialRoutes.patch("/comisiones/:id", requireAuth, requirePermiso("comercial.comision.editar"), validate({ params: idParams, body: updateComisionSchema }),
  asyncHandler(async (req, res) => res.json(await comercial.updateComision(tenant(req), req.params.id, req.body))));
