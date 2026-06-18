// Módulo FACTURACIÓN. Router FINO: HTTP + auth/requirePermiso/validate; la lógica
// (totales, estado derivado, transacciones, pagos) vive en facturacion.service y el
// acceso a datos en facturacion.repository (empresaId del token). Ver openspec
// facturacion-module.
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requirePermiso } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  anularFacturaSchema, createFacturaSchema, idParams, listFacturasQuery,
  pagoFacturaSchema, updateFacturaSchema,
} from "./facturacion.schemas";
import * as facturacion from "./facturacion.service";

export const facturacionRoutes: Router = Router();

const verGuard = [requireAuth, requirePermiso("facturacion.factura.ver")];
const gestionarGuard = [requireAuth, requirePermiso("facturacion.factura.gestionar")];

// ===================== LISTA / DETALLE =====================
facturacionRoutes.get(
  "/facturas",
  ...verGuard,
  validate({ query: listFacturasQuery }),
  asyncHandler(async (req, res) => {
    const { estado, clienteId } = req.query as Record<string, string | undefined>;
    res.json(await facturacion.listFacturas(tenant(req), { estado, clienteId }));
  }),
);

facturacionRoutes.get(
  "/facturas/:id",
  ...verGuard,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await facturacion.getFactura(tenant(req), req.params.id));
  }),
);

// ===================== CREAR / EDITAR / BORRAR (borrador) =====================
facturacionRoutes.post(
  "/facturas",
  ...gestionarGuard,
  validate({ body: createFacturaSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await facturacion.createFactura(tenant(req), req.body));
  }),
);

facturacionRoutes.patch(
  "/facturas/:id",
  ...gestionarGuard,
  validate({ params: idParams, body: updateFacturaSchema }),
  asyncHandler(async (req, res) => {
    res.json(await facturacion.updateFactura(tenant(req), req.params.id, req.body));
  }),
);

facturacionRoutes.delete(
  "/facturas/:id",
  ...gestionarGuard,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await facturacion.deleteFactura(tenant(req), req.params.id));
  }),
);

// ===================== EMITIR / ANULAR / PAGAR =====================
facturacionRoutes.post(
  "/facturas/:id/emitir",
  ...gestionarGuard,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await facturacion.emitirFactura(tenant(req), req.params.id));
  }),
);

facturacionRoutes.post(
  "/facturas/:id/anular",
  ...gestionarGuard,
  validate({ params: idParams, body: anularFacturaSchema }),
  asyncHandler(async (req, res) => {
    res.json(await facturacion.anularFactura(tenant(req), req.params.id, req.body.motivo));
  }),
);

facturacionRoutes.post(
  "/facturas/:id/pagos",
  ...gestionarGuard,
  validate({ params: idParams, body: pagoFacturaSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await facturacion.registrarPago(tenant(req), req.params.id, req.body));
  }),
);
