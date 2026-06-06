// Módulo FACTURACIÓN. Tenant-scoped (empresaId del token, hard WHERE,
// assertSameEmpresa) + requirePermiso con claves CONCRETAS (módulo "contable").
// La factura formal que el despacho EMITE a su cliente. Un pago = un Ingreso
// vinculado (Ingreso.facturaId): UNA sola fuente de dinero (mismo que alimenta
// Cartera). subtotal/IVA/total son snapshots; pagado/saldo/estadoPago se DERIVAN
// al leer, nunca se guardan. Ver openspec/changes/facturacion-module/.
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth, requirePermiso } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  anularFacturaSchema, createFacturaSchema, idParams, listFacturasQuery,
  pagoFacturaSchema, updateFacturaSchema,
} from "./facturacion.schemas";

export const facturacionRoutes: Router = Router();

const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const EPS = 0.005; // tolerancia para comparar dinero (Decimal 2 decimales)

// --- validadores same-empresa (las FK son escalares sin constraint en BD) ---
async function assertCliente(empresaId: string, clienteId: string) {
  if (!(await prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { id: true } })))
    throw new HttpError(404, "El cliente no pertenece a tu empresa");
}
async function assertContrato(empresaId: string, contratoId: string) {
  if (!(await prisma.contratoComercial.findFirst({ where: { id: contratoId, empresaId }, select: { id: true } })))
    throw new HttpError(404, "El contrato no pertenece a tu empresa");
}
async function procesoRadicado(empresaId: string, procesoId: string): Promise<string | null> {
  const p = await prisma.proceso.findFirst({ where: { id: procesoId, empresaId }, select: { radicado: true } });
  if (!p) throw new HttpError(404, "El proceso no pertenece a tu empresa");
  return p.radicado;
}
async function assertCuenta(empresaId: string, cuentaId: string) {
  if (!(await prisma.cuentaBancaria.findFirst({ where: { id: cuentaId, empresaId }, select: { id: true } })))
    throw new HttpError(404, "La cuenta no pertenece a tu empresa");
}

// --- cálculo de totales (snapshot desde los items) ---
type ItemIn = { descripcion: string; cantidad?: number; valorUnitario: number };
function itemsData(empresaId: string, items: ItemIn[]) {
  return items.map((it, i) => {
    const cantidad = it.cantidad ?? 1;
    return {
      empresaId, descripcion: it.descripcion, cantidad,
      valorUnitario: it.valorUnitario, total: cantidad * it.valorUnitario, orden: i,
    };
  });
}
function totales(lineas: { total: number }[], porcentajeIva: number) {
  const subtotal = lineas.reduce((s, it) => s + it.total, 0);
  const valorIva = Math.round(subtotal * porcentajeIva) / 100; // 2 decimales
  return { subtotal, valorIva, total: subtotal + valorIva };
}

// --- pagado/saldo/estadoPago DERIVADOS ---
async function pagadoDe(empresaId: string, facturaId: string): Promise<number> {
  const r = await prisma.ingreso.aggregate({
    _sum: { valorRecibido: true },
    where: { empresaId, facturaId, estadoPago: { in: ["PAGADO", "PARCIAL"] } },
  });
  return n(r._sum.valorRecibido);
}
function estadoPagoDerivado(
  f: { estado: string; total: Prisma.Decimal | number; fechaVencimiento: Date | null },
  pagado: number,
): string {
  if (f.estado === "ANULADA") return "ANULADA";
  if (f.estado === "BORRADOR") return "BORRADOR";
  const total = n(f.total);
  if (total > 0 && pagado >= total - EPS) return "PAGADA";
  if (pagado > 0) return "PARCIAL";
  if (f.fechaVencimiento && f.fechaVencimiento.getTime() < Date.now()) return "VENCIDA";
  return "PENDIENTE";
}
async function conEstado<T extends { id: string; empresaId: string; estado: string; total: Prisma.Decimal; fechaVencimiento: Date | null }>(f: T) {
  const pagado = await pagadoDe(f.empresaId, f.id);
  return { ...f, pagado, saldo: n(f.total) - pagado, estadoPago: estadoPagoDerivado(f, pagado) };
}

// ===================== LISTA / DETALLE =====================
facturacionRoutes.get("/facturas", requireAuth, requirePermiso("facturacion.factura.ver"),
  validate({ query: listFacturasQuery }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { estado, clienteId } = req.query as Record<string, string | undefined>;
    const filas = await prisma.factura.findMany({
      where: { empresaId, ...(estado ? { estado: estado as never } : {}), ...(clienteId ? { clienteId } : {}) },
      include: { cliente: { select: { nombre: true } } },
      orderBy: [{ fechaEmision: "desc" }, { createdAt: "desc" }],
    });
    res.json(await Promise.all(filas.map(conEstado)));
  }));

facturacionRoutes.get("/facturas/:id", requireAuth, requirePermiso("facturacion.factura.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const factura = await prisma.factura.findFirst({
      where: { id: req.params.id, empresaId },
      include: {
        items: { orderBy: { orden: "asc" } },
        cliente: { select: { nombre: true, email: true, numeroDocumento: true } },
      },
    });
    if (!factura) throw new HttpError(404, "Factura no encontrada");
    const pagos = await prisma.ingreso.findMany({
      where: { empresaId, facturaId: factura.id }, orderBy: { fechaIngreso: "desc" },
    });
    res.json({ ...(await conEstado(factura)), pagos });
  }));

// ===================== CREAR BORRADOR =====================
facturacionRoutes.post("/facturas", requireAuth, requirePermiso("facturacion.factura.gestionar"),
  validate({ body: createFacturaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const b = req.body;
    await assertCliente(empresaId, b.clienteId);
    if (b.contratoId) await assertContrato(empresaId, b.contratoId);
    let radicado: string | null = null;
    if (b.procesoId) radicado = await procesoRadicado(empresaId, b.procesoId);

    const porcentajeIva = b.porcentajeIva ?? 19;
    const lineas = itemsData(empresaId, b.items);
    const { subtotal, valorIva, total } = totales(lineas, porcentajeIva);

    const factura = await prisma.factura.create({
      data: {
        empresaId, clienteId: b.clienteId, contratoId: b.contratoId,
        configuracionCobroId: b.configuracionCobroId, procesoId: b.procesoId, radicado,
        porcentajeIva, subtotal, valorIva, total,
        fechaVencimiento: b.fechaVencimiento, observaciones: b.observaciones,
        registradoPorId: req.user!.sub,
        items: { create: lineas },
      },
      include: { items: { orderBy: { orden: "asc" } } },
    });
    res.status(201).json(await conEstado(factura));
  }));

// ===================== EDITAR / BORRAR (solo BORRADOR) =====================
facturacionRoutes.patch("/facturas/:id", requireAuth, requirePermiso("facturacion.factura.gestionar"),
  validate({ params: idParams, body: updateFacturaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const b = req.body;
    const actual = await prisma.factura.findFirst({
      where: { id: req.params.id, empresaId }, include: { items: true },
    });
    if (!actual) throw new HttpError(404, "Factura no encontrada");
    if (actual.estado !== "BORRADOR") throw new HttpError(409, "Solo se puede editar un borrador");

    const porcentajeIva = b.porcentajeIva ?? n(actual.porcentajeIva);
    const lineas = b.items ? itemsData(empresaId, b.items) : actual.items.map((it) => ({ total: n(it.total) }));
    const { subtotal, valorIva, total } = totales(lineas, porcentajeIva);

    const factura = await prisma.$transaction(async (tx) => {
      if (b.items) await tx.facturaItem.deleteMany({ where: { facturaId: actual.id } });
      return tx.factura.update({
        where: { id: actual.id },
        data: {
          porcentajeIva, subtotal, valorIva, total,
          ...(b.fechaVencimiento !== undefined ? { fechaVencimiento: b.fechaVencimiento } : {}),
          ...(b.observaciones !== undefined ? { observaciones: b.observaciones } : {}),
          ...(b.items ? { items: { create: itemsData(empresaId, b.items) } } : {}),
        },
        include: { items: { orderBy: { orden: "asc" } } },
      });
    });
    res.json(await conEstado(factura));
  }));

facturacionRoutes.delete("/facturas/:id", requireAuth, requirePermiso("facturacion.factura.gestionar"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const f = await prisma.factura.findFirst({ where: { id: req.params.id, empresaId }, select: { id: true, estado: true } });
    if (!f) throw new HttpError(404, "Factura no encontrada");
    if (f.estado !== "BORRADOR") throw new HttpError(409, "Solo se puede borrar un borrador");
    await prisma.factura.delete({ where: { id: f.id } });
    res.json({ id: f.id, deleted: true });
  }));

// ===================== EMITIR (asigna consecutivo) =====================
facturacionRoutes.post("/facturas/:id/emitir", requireAuth, requirePermiso("facturacion.factura.gestionar"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const year = new Date().getFullYear();
    const prefix = `FAC-${year}-`;

    const factura = await prisma.$transaction(async (tx) => {
      const f = await tx.factura.findFirst({
        where: { id: req.params.id, empresaId }, include: { items: { orderBy: { orden: "asc" } } },
      });
      if (!f) throw new HttpError(404, "Factura no encontrada");
      if (f.estado !== "BORRADOR") throw new HttpError(409, "La factura ya fue emitida o anulada");
      if (f.items.length === 0) throw new HttpError(409, "La factura no tiene ítems");

      // Siguiente consecutivo de la empresa para el año (padding 4 → orden lexicográfico = numérico).
      const ultima = await tx.factura.findFirst({
        where: { empresaId, numero: { startsWith: prefix } },
        orderBy: { numero: "desc" }, select: { numero: true },
      });
      const seq = ultima?.numero ? parseInt(ultima.numero.slice(prefix.length), 10) : 0;
      const numero = `${prefix}${String(seq + 1).padStart(4, "0")}`;

      return tx.factura.update({
        where: { id: f.id },
        data: { numero, estado: "EMITIDA", fechaEmision: new Date() },
        include: { items: { orderBy: { orden: "asc" } } },
      });
    });
    res.json(await conEstado(factura));
  }));

// ===================== ANULAR =====================
facturacionRoutes.post("/facturas/:id/anular", requireAuth, requirePermiso("facturacion.factura.gestionar"),
  validate({ params: idParams, body: anularFacturaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const f = await prisma.factura.findFirst({ where: { id: req.params.id, empresaId }, select: { id: true, estado: true } });
    if (!f) throw new HttpError(404, "Factura no encontrada");
    if (f.estado !== "EMITIDA") throw new HttpError(409, "Solo se puede anular una factura emitida");
    const factura = await prisma.factura.update({
      where: { id: f.id },
      data: { estado: "ANULADA", motivoAnulacion: req.body.motivo },
      include: { items: { orderBy: { orden: "asc" } } },
    });
    res.json(await conEstado(factura));
  }));

// ===================== REGISTRAR PAGO (= Ingreso vinculado) =====================
facturacionRoutes.post("/facturas/:id/pagos", requireAuth, requirePermiso("facturacion.factura.gestionar"),
  validate({ params: idParams, body: pagoFacturaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const b = req.body;
    const factura = await prisma.factura.findFirst({ where: { id: req.params.id, empresaId } });
    if (!factura) throw new HttpError(404, "Factura no encontrada");
    if (factura.estado !== "EMITIDA") throw new HttpError(409, "Solo se puede pagar una factura emitida");
    if (b.cuentaId) await assertCuenta(empresaId, b.cuentaId);

    const pagado = await pagadoDe(empresaId, factura.id);
    const saldo = n(factura.total) - pagado;
    if (b.valorRecibido - saldo > EPS) {
      throw new HttpError(400, `El pago (${b.valorRecibido}) excede el saldo pendiente (${saldo})`);
    }

    await prisma.ingreso.create({
      data: {
        empresaId, clienteId: factura.clienteId, facturaId: factura.id,
        contratoId: factura.contratoId, configuracionCobroId: factura.configuracionCobroId,
        procesoId: factura.procesoId, radicado: factura.radicado,
        conceptoPago: `Pago factura ${factura.numero ?? factura.id}`,
        tipoCobro: b.tipoCobro ?? "ABONO",
        valorRecibido: b.valorRecibido, metodoPago: b.metodoPago,
        fechaIngreso: b.fechaIngreso, cuentaId: b.cuentaId,
        numeroComprobante: b.numeroComprobante, observaciones: b.observaciones,
        estadoPago: "PAGADO", registradoPorId: req.user!.sub,
      },
    });
    const fresca = await prisma.factura.findUniqueOrThrow({
      where: { id: factura.id }, include: { items: { orderBy: { orden: "asc" } } },
    });
    res.status(201).json(await conEstado(fresca));
  }));
