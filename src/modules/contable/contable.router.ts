// Módulo CONTABLE. Router FINO: HTTP + auth/requirePermiso/validate; la lógica
// (saldos derivados, asserts same-empresa, transacciones) vive en contable.service
// y las queries en contable.repository (empresaId del token). Ver openspec
// contable-module.
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requirePermiso } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import { parsePage } from "../../shared/pagination";
import {
  createCajaSchema, createCarteraSchema, createCuentaSchema, createEgresoSchema,
  createIngresoSchema, createMovimientoSchema, createNominaSchema, createServicioFijoSchema,
  createServicioFijoRecurrenteSchema, generarServiciosFijosSchema,
  idParams, reporteQuery, updateCajaSchema, updateCuentaSchema, updateEgresoSchema,
  updateNominaSchema, updateServicioFijoSchema, updateServicioFijoRecurrenteSchema,
} from "./contable.schemas";
import * as contable from "./contable.service";

export const contableRoutes: Router = Router();
const q = (req: { query: Record<string, unknown> }, k: string) =>
  typeof req.query[k] === "string" ? (req.query[k] as string) : undefined;

// ===================== INGRESOS =====================
contableRoutes.get("/ingresos", requireAuth, requirePermiso("contable.ingreso.ver"),
  asyncHandler(async (req, res) => {
    res.json(await contable.listIngresos(tenant(req), { clienteId: q(req, "clienteId"), procesoId: q(req, "procesoId"), page: parsePage(req.query) }));
  }));
contableRoutes.post("/ingresos", requireAuth, requirePermiso("contable.ingreso.crear"),
  validate({ body: createIngresoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createIngreso(tenant(req), req.body))));

// ===================== EGRESOS =====================
contableRoutes.get("/egresos", requireAuth, requirePermiso("contable.egreso.ver"),
  asyncHandler(async (req, res) => {
    res.json(await contable.listEgresos(tenant(req), { categoria: q(req, "categoria"), procesoId: q(req, "procesoId"), page: parsePage(req.query) }));
  }));
contableRoutes.post("/egresos", requireAuth, requirePermiso("contable.egreso.crear"),
  validate({ body: createEgresoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createEgreso(tenant(req), req.body))));
contableRoutes.patch("/egresos/:id", requireAuth, requirePermiso("contable.egreso.editar"),
  validate({ params: idParams, body: updateEgresoSchema }),
  asyncHandler(async (req, res) => res.json(await contable.updateEgreso(tenant(req), req.params.id, req.body))));

// ===================== NÓMINA =====================
contableRoutes.get("/nominas", requireAuth, requirePermiso("contable.nomina.ver"),
  asyncHandler(async (req, res) => res.json(await contable.listNominas(tenant(req), q(req, "periodo")))));
contableRoutes.get("/nominas/empleables", requireAuth, requirePermiso("contable.nomina.crear"),
  asyncHandler(async (req, res) => res.json(await contable.listEmpleables(tenant(req)))));
contableRoutes.post("/nominas", requireAuth, requirePermiso("contable.nomina.crear"),
  validate({ body: createNominaSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createNomina(tenant(req), req.body))));
contableRoutes.patch("/nominas/:id", requireAuth, requirePermiso("contable.nomina.editar"),
  validate({ params: idParams, body: updateNominaSchema }),
  asyncHandler(async (req, res) => res.json(await contable.updateNomina(tenant(req), req.params.id, req.body))));

// ===================== CAJA MENOR =====================
contableRoutes.get("/cajas", requireAuth, requirePermiso("contable.cajamenor.ver"),
  asyncHandler(async (req, res) => res.json(await contable.listCajas(tenant(req)))));
contableRoutes.post("/cajas", requireAuth, requirePermiso("contable.cajamenor.crear"),
  validate({ body: createCajaSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createCaja(tenant(req), req.body))));
contableRoutes.get("/cajas/:id", requireAuth, requirePermiso("contable.cajamenor.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await contable.getCaja(tenant(req), req.params.id))));
contableRoutes.post("/cajas/:id/movimientos", requireAuth, requirePermiso("contable.cajamenor.crear"),
  validate({ params: idParams, body: createMovimientoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createMovimiento(tenant(req), req.params.id, req.body))));
contableRoutes.patch("/cajas/:id", requireAuth, requirePermiso("contable.cajamenor.editar"),
  validate({ params: idParams, body: updateCajaSchema }),
  asyncHandler(async (req, res) => res.json(await contable.updateCaja(tenant(req), req.params.id, req.body))));

// ===================== SERVICIOS FIJOS =====================
contableRoutes.get("/servicios-fijos", requireAuth, requirePermiso("contable.serviciofijo.ver"),
  asyncHandler(async (req, res) => res.json(await contable.listServiciosFijos(tenant(req), q(req, "periodo")))));
contableRoutes.post("/servicios-fijos", requireAuth, requirePermiso("contable.serviciofijo.crear"),
  validate({ body: createServicioFijoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createServicioFijo(tenant(req), req.body))));
contableRoutes.patch("/servicios-fijos/:id", requireAuth, requirePermiso("contable.serviciofijo.editar"),
  validate({ params: idParams, body: updateServicioFijoSchema }),
  asyncHandler(async (req, res) => res.json(await contable.updateServicioFijo(tenant(req), req.params.id, req.body))));

// ===================== SERVICIOS FIJOS RECURRENTES =====================
contableRoutes.get("/servicios-fijos-recurrentes", requireAuth, requirePermiso("contable.serviciofijo.ver"),
  asyncHandler(async (req, res) => res.json(await contable.listRecurrentes(tenant(req)))));
contableRoutes.post("/servicios-fijos-recurrentes", requireAuth, requirePermiso("contable.serviciofijo.crear"),
  validate({ body: createServicioFijoRecurrenteSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createRecurrente(tenant(req), req.body))));
contableRoutes.patch("/servicios-fijos-recurrentes/:id", requireAuth, requirePermiso("contable.serviciofijo.editar"),
  validate({ params: idParams, body: updateServicioFijoRecurrenteSchema }),
  asyncHandler(async (req, res) => res.json(await contable.updateRecurrente(tenant(req), req.params.id, req.body))));
contableRoutes.post("/servicios-fijos-recurrentes/generar", requireAuth, requirePermiso("contable.serviciofijo.crear"),
  validate({ body: generarServiciosFijosSchema }),
  asyncHandler(async (req, res) => res.json(await contable.generarServiciosFijos(tenant(req), (req.body as { periodo: string }).periodo))));

// ===================== CUENTAS =====================
contableRoutes.get("/cuentas", requireAuth, requirePermiso("contable.cuenta.ver"),
  asyncHandler(async (req, res) => res.json(await contable.listCuentas(tenant(req)))));
contableRoutes.post("/cuentas", requireAuth, requirePermiso("contable.cuenta.crear"),
  validate({ body: createCuentaSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createCuenta(tenant(req), req.body))));
contableRoutes.get("/cuentas/:id", requireAuth, requirePermiso("contable.cuenta.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await contable.getCuenta(tenant(req), req.params.id))));
contableRoutes.patch("/cuentas/:id", requireAuth, requirePermiso("contable.cuenta.editar"),
  validate({ params: idParams, body: updateCuentaSchema }),
  asyncHandler(async (req, res) => res.json(await contable.updateCuenta(tenant(req), req.params.id, req.body))));
contableRoutes.delete("/cuentas/:id", requireAuth, requirePermiso("contable.cuenta.editar"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => { await contable.deleteCuenta(tenant(req), req.params.id); res.status(204).end(); }));

// ===================== CARTERA =====================
contableRoutes.get("/cartera", requireAuth, requirePermiso("contable.cartera.ver"),
  asyncHandler(async (req, res) => res.json(await contable.listCartera(tenant(req), q(req, "clienteId"), parsePage(req.query)))));
contableRoutes.post("/cartera", requireAuth, requirePermiso("contable.cartera.ver"),
  validate({ body: createCarteraSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contable.createCartera(tenant(req), req.body))));
contableRoutes.post("/cartera/:id/resync", requireAuth, requirePermiso("contable.cartera.resync"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => res.json(await contable.resyncCartera(tenant(req), req.params.id))));

// ===================== REPORTES =====================
contableRoutes.get("/reportes", requireAuth, requirePermiso("contable.reporte.ver"),
  validate({ query: reporteQuery }),
  asyncHandler(async (req, res) => res.json(await contable.reporte(tenant(req), String(req.query.periodo)))));
