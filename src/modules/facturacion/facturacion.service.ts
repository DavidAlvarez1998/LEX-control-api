// Casos de uso de Facturación (tenant-scoped). Totales snapshot desde los ítems;
// pagado/saldo/estadoPago derivados; un pago = un Ingreso vinculado. Transacciones
// para editar/emitir. Sin Express; empresaId vía TenantContext → repositorio.
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { FacturasRepository } from "./facturacion.repository";
import { EPS, n, withEstado } from "./facturacion.dto";
import type { CreateFacturaInput, PagoFacturaInput, UpdateFacturaInput } from "./facturacion.schemas";

// --- cálculo de totales (snapshot desde los items) ---
type ItemIn = { descripcion: string; cantidad?: number; valorUnitario: number };
function itemsData(empresaId: string, items: ItemIn[]) {
  return items.map((it, i) => {
    const cantidad = it.cantidad ?? 1;
    return { empresaId, descripcion: it.descripcion, cantidad, valorUnitario: it.valorUnitario, total: cantidad * it.valorUnitario, orden: i };
  });
}
function totales(lineas: { total: number }[], porcentajeIva: number) {
  const subtotal = lineas.reduce((s, it) => s + it.total, 0);
  const valorIva = Math.round(subtotal * porcentajeIva) / 100;
  return { subtotal, valorIva, total: subtotal + valorIva };
}

/** Ensambla la factura con pagado/saldo/estadoPago (fetch del pagado + derivación). */
async function conEstado<T extends { id: string; total: import("@prisma/client").Prisma.Decimal; estado: string; fechaVencimiento: Date | null }>(
  repo: FacturasRepository,
  f: T,
) {
  return withEstado(f, await repo.pagadoSum(f.id));
}

// --- validadores same-empresa ---
async function assertCliente(repo: FacturasRepository, clienteId: string) {
  if (!(await repo.clienteExists(clienteId))) throw new HttpError(404, "El cliente no pertenece a tu empresa");
}
async function assertContrato(repo: FacturasRepository, contratoId: string) {
  if (!(await repo.contratoExists(contratoId))) throw new HttpError(404, "El contrato no pertenece a tu empresa");
}
async function assertCuenta(repo: FacturasRepository, cuentaId: string) {
  if (!(await repo.cuentaExists(cuentaId))) throw new HttpError(404, "La cuenta no pertenece a tu empresa");
}
async function procesoRadicado(repo: FacturasRepository, procesoId: string): Promise<string | null> {
  const p = await repo.findProceso(procesoId);
  if (!p) throw new HttpError(404, "El proceso no pertenece a tu empresa");
  return p.radicado;
}

export async function listFacturas(t: TenantContext, filtros: { estado?: string; clienteId?: string }) {
  const repo = new FacturasRepository(empresaIdOrThrow(t));
  const filas = await repo.list(filtros);
  return Promise.all(filas.map((f) => conEstado(repo, f)));
}

export async function getFactura(t: TenantContext, id: string) {
  const repo = new FacturasRepository(empresaIdOrThrow(t));
  const factura = await repo.findDetalle(id);
  if (!factura) throw new HttpError(404, "Factura no encontrada");
  const pagos = await repo.listPagos(factura.id);
  return { ...(await conEstado(repo, factura)), pagos };
}

export async function createFactura(t: TenantContext, b: CreateFacturaInput) {
  const empresaId = empresaIdOrThrow(t);
  const repo = new FacturasRepository(empresaId);
  await assertCliente(repo, b.clienteId);
  if (b.contratoId) await assertContrato(repo, b.contratoId);
  let radicado: string | null = null;
  if (b.procesoId) radicado = await procesoRadicado(repo, b.procesoId);

  const porcentajeIva = b.porcentajeIva ?? 19;
  const lineas = itemsData(empresaId, b.items);
  const { subtotal, valorIva, total } = totales(lineas, porcentajeIva);

  const factura = await repo.create({
    empresaId, clienteId: b.clienteId, contratoId: b.contratoId,
    configuracionCobroId: b.configuracionCobroId, procesoId: b.procesoId, radicado,
    porcentajeIva, subtotal, valorIva, total,
    fechaVencimiento: b.fechaVencimiento, observaciones: b.observaciones,
    registradoPorId: t.userId,
    items: { create: lineas },
  });
  return conEstado(repo, factura);
}

export async function updateFactura(t: TenantContext, id: string, b: UpdateFacturaInput) {
  const empresaId = empresaIdOrThrow(t);
  const repo = new FacturasRepository(empresaId);
  const actual = await repo.findConItems(id);
  if (!actual) throw new HttpError(404, "Factura no encontrada");
  if (actual.estado !== "BORRADOR") throw new HttpError(409, "Solo se puede editar un borrador");

  const porcentajeIva = b.porcentajeIva ?? n(actual.porcentajeIva);
  const lineas = b.items ? itemsData(empresaId, b.items) : actual.items.map((it) => ({ total: n(it.total) }));
  const { subtotal, valorIva, total } = totales(lineas, porcentajeIva);

  const factura = await prisma.$transaction(async (tx) => {
    const r = new FacturasRepository(empresaId, tx);
    if (b.items) await r.deleteItems(actual.id);
    return r.update(actual.id, {
      porcentajeIva, subtotal, valorIva, total,
      ...(b.fechaVencimiento !== undefined ? { fechaVencimiento: b.fechaVencimiento } : {}),
      ...(b.observaciones !== undefined ? { observaciones: b.observaciones } : {}),
      ...(b.items ? { items: { create: itemsData(empresaId, b.items) } } : {}),
    });
  });
  return conEstado(repo, factura);
}

export async function deleteFactura(t: TenantContext, id: string) {
  const repo = new FacturasRepository(empresaIdOrThrow(t));
  const f = await repo.findEstado(id);
  if (!f) throw new HttpError(404, "Factura no encontrada");
  if (f.estado !== "BORRADOR") throw new HttpError(409, "Solo se puede borrar un borrador");
  await repo.delete(f.id);
  return { id: f.id, deleted: true };
}

export async function emitirFactura(t: TenantContext, id: string) {
  const empresaId = empresaIdOrThrow(t);
  const prefix = `FAC-${new Date().getFullYear()}-`;
  const factura = await prisma.$transaction(async (tx) => {
    const r = new FacturasRepository(empresaId, tx);
    const f = await r.findConItems(id);
    if (!f) throw new HttpError(404, "Factura no encontrada");
    if (f.estado !== "BORRADOR") throw new HttpError(409, "La factura ya fue emitida o anulada");
    if (f.items.length === 0) throw new HttpError(409, "La factura no tiene ítems");
    const ultima = await r.ultimaConPrefijo(prefix);
    const seq = ultima?.numero ? parseInt(ultima.numero.slice(prefix.length), 10) : 0;
    const numero = `${prefix}${String(seq + 1).padStart(4, "0")}`;
    return r.update(f.id, { numero, estado: "EMITIDA", fechaEmision: new Date() });
  });
  return conEstado(new FacturasRepository(empresaId), factura);
}

export async function anularFactura(t: TenantContext, id: string, motivo: string) {
  const repo = new FacturasRepository(empresaIdOrThrow(t));
  const f = await repo.findEstado(id);
  if (!f) throw new HttpError(404, "Factura no encontrada");
  if (f.estado !== "EMITIDA") throw new HttpError(409, "Solo se puede anular una factura emitida");
  const factura = await repo.update(f.id, { estado: "ANULADA", motivoAnulacion: motivo });
  return conEstado(repo, factura);
}

export async function registrarPago(t: TenantContext, id: string, b: PagoFacturaInput) {
  const empresaId = empresaIdOrThrow(t);
  // Read-check-write (estado + saldo + creación del Ingreso) en una sola transacción
  // para que dos pagos concurrentes no puedan exceder el saldo entre la lectura y la
  // escritura. La idempotencia por `numeroComprobante` corta reintentos/doble-submit:
  // el mismo comprobante por factura es el MISMO pago, no uno nuevo.
  await prisma.$transaction(async (tx) => {
    const r = new FacturasRepository(empresaId, tx);
    const factura = await r.findPlain(id);
    if (!factura) throw new HttpError(404, "Factura no encontrada");
    if (factura.estado !== "EMITIDA") throw new HttpError(409, "Solo se puede pagar una factura emitida");
    if (b.cuentaId) await assertCuenta(r, b.cuentaId);

    if (b.numeroComprobante && (await r.findIngresoPorComprobante(factura.id, b.numeroComprobante))) {
      return; // pago ya registrado con ese comprobante → no-op idempotente
    }

    const pagado = await r.pagadoSum(factura.id);
    const saldo = n(factura.total) - pagado;
    if (b.valorRecibido - saldo > EPS) {
      throw new HttpError(400, `El pago (${b.valorRecibido}) excede el saldo pendiente (${saldo})`);
    }

    await r.createIngreso({
      empresaId, clienteId: factura.clienteId, facturaId: factura.id,
      contratoId: factura.contratoId, configuracionCobroId: factura.configuracionCobroId,
      procesoId: factura.procesoId, radicado: factura.radicado,
      conceptoPago: `Pago factura ${factura.numero ?? factura.id}`,
      tipoCobro: b.tipoCobro ?? "ABONO",
      valorRecibido: b.valorRecibido, metodoPago: b.metodoPago,
      fechaIngreso: b.fechaIngreso, cuentaId: b.cuentaId,
      numeroComprobante: b.numeroComprobante, observaciones: b.observaciones,
      estadoPago: "PAGADO", registradoPorId: t.userId,
    });
  });
  const repo = new FacturasRepository(empresaId);
  const fresca = await repo.findByIdConItems(id);
  return conEstado(repo, fresca);
}
