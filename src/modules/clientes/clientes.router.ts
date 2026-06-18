// Módulo CRM: clientes/prospectos del despacho. Router FINO — solo HTTP: auth/RBAC,
// validación, llamar al service y mapear con el DTO. La lógica vive en
// clientes.service y el acceso a datos en clientes.repository (empresaId forzado).
// Ver openspec/changes/api-arquitectura-refactor (Fase 1, piloto).
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requirePermiso } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  clienteIdParams,
  createClienteSchema,
  updateClienteSchema,
} from "./clientes.schemas";
import * as clientes from "./clientes.service";
import { toClienteDTO } from "./clientes.dto";

export const clienteRoutes: Router = Router();

/**
 * GET /clientes — lista del despacho. Filtros: `?estado=`, `?mios=true`
 * (los que el usuario lleva comercialmente o como abogado responsable).
 */
clienteRoutes.get(
  "/",
  requireAuth,
  requirePermiso("cliente.ver"),
  asyncHandler(async (req, res) => {
    const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
    const mios = req.query.mios === "true";
    const lista = await clientes.listClientes(tenant(req), { estado, mios });
    res.json(lista.map(toClienteDTO));
  }),
);

/** GET /clientes/:id — un cliente del despacho. */
clienteRoutes.get(
  "/:id",
  requireAuth,
  requirePermiso("cliente.ver"),
  validate({ params: clienteIdParams }),
  asyncHandler(async (req, res) => {
    const cliente = await clientes.getCliente(tenant(req), req.params.id);
    res.json(toClienteDTO(cliente));
  }),
);

/** POST /clientes — crea un prospecto. */
clienteRoutes.post(
  "/",
  requireAuth,
  requirePermiso("cliente.crear"),
  validate({ body: createClienteSchema }),
  asyncHandler(async (req, res) => {
    const cliente = await clientes.createCliente(tenant(req), req.body);
    res.status(201).json(toClienteDTO(cliente));
  }),
);

/** PATCH /clientes/:id — edita un cliente (no convierte a CLIENTE). */
clienteRoutes.patch(
  "/:id",
  requireAuth,
  requirePermiso("cliente.editar"),
  validate({ params: clienteIdParams, body: updateClienteSchema }),
  asyncHandler(async (req, res) => {
    const cliente = await clientes.updateCliente(tenant(req), req.params.id, req.body);
    res.json(toClienteDTO(cliente));
  }),
);

/** POST /clientes/:id/convertir — PROSPECTO → CLIENTE (vincula Litigante). */
clienteRoutes.post(
  "/:id/convertir",
  requireAuth,
  requirePermiso("cliente.convertir"),
  validate({ params: clienteIdParams }),
  asyncHandler(async (req, res) => {
    const cliente = await clientes.convertirClienteUseCase(tenant(req), req.params.id);
    res.json(toClienteDTO(cliente));
  }),
);
