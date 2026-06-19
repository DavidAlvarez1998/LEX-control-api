// Casos de uso del módulo Contable (tenant-scoped). LEE el plan de cobro del
// comercial (ConfiguracionCobro), nunca lo reescribe. Saldos DERIVADOS al leer.
// empresaId vía TenantContext → repositorio. Sin Express.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { paginated, type PageParams } from "../../shared/pagination";
import { ContableRepository } from "./contable.repository";
import { conSaldo, n } from "./cartera.service";
import type {
  createCajaSchema, createCarteraSchema, createCuentaSchema, createEgresoSchema,
  createIngresoSchema, createMovimientoSchema, createNominaSchema, createServicioFijoSchema,
  createServicioFijoRecurrenteSchema, updateCajaSchema, updateCuentaSchema, updateEgresoSchema,
  updateNominaSchema, updateServicioFijoSchema, updateServicioFijoRecurrenteSchema,
} from "./contable.schemas";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const num = (d: Prisma.Decimal | null | undefined) => n(d);

// --- asserts same-empresa (contable usa 400) ---
async function assertCliente(r: ContableRepository, id: string) {
  if (!(await r.clienteExists(id))) throw new HttpError(400, "El cliente no pertenece a tu empresa");
}
async function assertCuenta(r: ContableRepository, id: string) {
  if (!(await r.cuentaExists(id))) throw new HttpError(400, "La cuenta no pertenece a tu empresa");
}
async function assertEmpleado(r: ContableRepository, id: string) {
  if (!(await r.empleadoExists(id))) throw new HttpError(400, "El empleado no pertenece a tu empresa");
}
async function procesoRadicado(r: ContableRepository, id: string): Promise<string | null> {
  const p = await r.findProceso(id);
  if (!p) throw new HttpError(400, "El proceso no pertenece a tu empresa");
  return p.radicado;
}
const repo = (t: TenantContext) => new ContableRepository(empresaIdOrThrow(t));

// ===================== INGRESOS =====================
export async function listIngresos(t: TenantContext, f: { clienteId?: string; procesoId?: string; page?: PageParams | null }) {
  const r = repo(t);
  if (!f.page) return r.listIngresos(f); // sin ?page → array (retrocompatible)
  const [total, items] = await r.listIngresosPaginated(f, f.page);
  return paginated(items, total, f.page);
}
export async function createIngreso(t: TenantContext, b: In<typeof createIngresoSchema>) {
  const r = repo(t);
  await assertCliente(r, b.clienteId);
  let radicado: string | null = null;
  if (b.procesoId) radicado = await procesoRadicado(r, b.procesoId);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  return r.createIngreso({ ...b, empresaId: empresaIdOrThrow(t), radicado, registradoPorId: t.userId });
}

// ===================== EGRESOS =====================
export async function listEgresos(t: TenantContext, f: { categoria?: string; procesoId?: string; page?: PageParams | null }) {
  const r = repo(t);
  if (!f.page) return r.listEgresos(f);
  const [total, items] = await r.listEgresosPaginated(f, f.page);
  return paginated(items, total, f.page);
}
export async function createEgreso(t: TenantContext, b: In<typeof createEgresoSchema>) {
  const r = repo(t);
  if (b.clienteId) await assertCliente(r, b.clienteId);
  let radicado: string | null = null;
  if (b.procesoId) radicado = await procesoRadicado(r, b.procesoId);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  return r.createEgreso({ ...b, empresaId: empresaIdOrThrow(t), radicado, registradoPorId: t.userId });
}
export async function updateEgreso(t: TenantContext, id: string, b: In<typeof updateEgresoSchema>) {
  const r = repo(t);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  if ((await r.updateEgreso(id, b)) === 0) throw new HttpError(404, "Egreso no encontrado");
  return r.findEgreso(id);
}

// ===================== NÓMINA =====================
export function listNominas(t: TenantContext, periodo?: string) {
  return repo(t).listNominas(periodo);
}
export async function listEmpleables(t: TenantContext) {
  const contratos = await repo(t).listEmpleables();
  return contratos.map((c) => ({
    contratoId: c.id, usuarioId: c.usuarioId, nombre: c.nombreCompleto, cargo: c.cargo,
    honorarios: c.honorarios, tipoContrato: c.tipoContrato, fechaInicio: c.fechaInicio, estado: c.estado,
  }));
}
export async function createNomina(t: TenantContext, b: In<typeof createNominaSchema>) {
  const r = repo(t);
  if (b.empleadoId) await assertEmpleado(r, b.empleadoId);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  return r.createNomina({ ...b, empresaId: empresaIdOrThrow(t) });
}
export async function updateNomina(t: TenantContext, id: string, b: In<typeof updateNominaSchema>) {
  const r = repo(t);
  if (b.empleadoId) await assertEmpleado(r, b.empleadoId);
  if ((await r.updateNomina(id, b)) === 0) throw new HttpError(404, "Nómina no encontrada");
  return r.findNomina(id);
}

// ===================== CAJA MENOR =====================
export async function listCajas(t: TenantContext) {
  const r = repo(t);
  const cajas = await r.listCajas();
  const movs = await r.cajaMovsGroupBy();
  const delta = new Map<string, number>();
  for (const m of movs) {
    const signo = m.tipoMovimiento === "REPOSICION" ? 1 : -1;
    delta.set(m.cajaId, (delta.get(m.cajaId) ?? 0) + signo * num(m._sum.valor));
  }
  return cajas.map((c) => ({ ...c, saldoActual: num(c.montoInicial) + (delta.get(c.id) ?? 0) }));
}
export function createCaja(t: TenantContext, b: In<typeof createCajaSchema>) {
  return repo(t).createCaja({ ...b, empresaId: empresaIdOrThrow(t) });
}
export async function getCaja(t: TenantContext, id: string) {
  const r = repo(t);
  const caja = await r.findCaja(id);
  if (!caja) throw new HttpError(404, "Caja menor no encontrada");
  const movimientos = await r.listCajaMovs(caja.id);
  const salidas = movimientos.filter((m) => m.tipoMovimiento === "SALIDA").reduce((s, m) => s + num(m.valor), 0);
  const reposiciones = movimientos.filter((m) => m.tipoMovimiento === "REPOSICION").reduce((s, m) => s + num(m.valor), 0);
  return { ...caja, saldoActual: num(caja.montoInicial) - salidas + reposiciones, movimientos };
}
export async function createMovimiento(t: TenantContext, cajaId: string, b: In<typeof createMovimientoSchema>) {
  const r = repo(t);
  const caja = await r.findCajaEstado(cajaId);
  if (!caja) throw new HttpError(404, "Caja menor no encontrada");
  if (caja.estado === "CERRADA") throw new HttpError(400, "La caja menor está cerrada");
  let radicado: string | null = null;
  if (b.procesoId) radicado = await procesoRadicado(r, b.procesoId);
  return r.createMovimiento({ ...b, cajaId: caja.id, empresaId: empresaIdOrThrow(t), radicado });
}
export async function updateCaja(t: TenantContext, id: string, b: In<typeof updateCajaSchema>) {
  const r = repo(t);
  if ((await r.updateCaja(id, b)) === 0) throw new HttpError(404, "Caja menor no encontrada");
  return r.findCajaById(id);
}

// ===================== SERVICIOS FIJOS =====================
export async function listServiciosFijos(t: TenantContext, periodo?: string) {
  const filas = await repo(t).listServiciosFijos(periodo);
  const ahora = new Date();
  return filas.map((s) => ({ ...s, vencido: s.estadoPago !== "PAGADO" && s.fechaVencimiento != null && s.fechaVencimiento < ahora }));
}
export async function createServicioFijo(t: TenantContext, b: In<typeof createServicioFijoSchema>) {
  const r = repo(t);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  try {
    return await r.createServicioFijo({ ...b, empresaId: empresaIdOrThrow(t) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe ese servicio fijo para el proveedor y periodo");
    }
    throw err;
  }
}
export async function updateServicioFijo(t: TenantContext, id: string, b: In<typeof updateServicioFijoSchema>) {
  const r = repo(t);
  if ((await r.updateServicioFijo(id, b)) === 0) throw new HttpError(404, "Servicio fijo no encontrado");
  return r.findServicioFijo(id);
}

// ===================== SERVICIOS FIJOS RECURRENTES =====================
function fechaVencimientoDe(periodo: string, diaPago: number): Date {
  const [y, m] = periodo.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(diaPago, ultimoDia)));
}
export function listRecurrentes(t: TenantContext) {
  return repo(t).listRecurrentes();
}
export async function createRecurrente(t: TenantContext, b: In<typeof createServicioFijoRecurrenteSchema>) {
  const r = repo(t);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  try {
    return await r.createRecurrente({ ...b, empresaId: empresaIdOrThrow(t) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe una plantilla para ese tipo de servicio y proveedor");
    }
    throw err;
  }
}
export async function updateRecurrente(t: TenantContext, id: string, b: In<typeof updateServicioFijoRecurrenteSchema>) {
  const r = repo(t);
  if (b.cuentaId) await assertCuenta(r, b.cuentaId);
  if ((await r.updateRecurrente(id, b)) === 0) throw new HttpError(404, "Plantilla no encontrada");
  return r.findRecurrente(id);
}
export async function generarServiciosFijos(t: TenantContext, periodo: string) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const mes = Number(periodo.split("-")[1]);
  const plantillas = await r.listRecurrentesActivas();
  const aplican = plantillas.filter((p) => p.frecuencia === "MENSUAL" || p.mesPago === mes);
  const data = aplican.map((p) => ({
    empresaId, periodo, tipoServicio: p.tipoServicio, proveedor: p.proveedor,
    valorFacturado: p.valorEstimado, fechaVencimiento: fechaVencimientoDe(periodo, p.diaPago),
    estadoPago: "PENDIENTE" as const, cuentaId: p.cuentaId, recurrenteId: p.id,
  }));
  const { count } = data.length ? await r.createManyServicioFijo(data) : { count: 0 };
  return { periodo, candidatas: aplican.length, generadas: count, omitidas: aplican.length - count };
}

// ===================== CUENTAS =====================
export async function listCuentas(t: TenantContext) {
  const r = repo(t);
  const cuentas = await r.listCuentas();
  const [ing, egr, sf, nom] = await r.cuentasSums();
  const sumBy = (rows: { cuentaId: string | null; _sum: Record<string, unknown> }[], field: string) =>
    // `_sum[field]` es acceso por clave dinámica → unknown; cast aislado a Decimal.
    new Map(rows.map((x) => [x.cuentaId, num(x._sum[field] as Prisma.Decimal | null)]));
  const mIng = sumBy(ing, "valorRecibido"), mEgr = sumBy(egr, "valorGasto"), mSf = sumBy(sf, "valorFacturado"), mNom = sumBy(nom, "valorNetoPagar");
  return cuentas.map((c) => ({
    ...c,
    saldoActual: num(c.saldoInicial) + (mIng.get(c.id) ?? 0) - (mEgr.get(c.id) ?? 0) - (mSf.get(c.id) ?? 0) - (mNom.get(c.id) ?? 0),
  }));
}
export function createCuenta(t: TenantContext, b: In<typeof createCuentaSchema>) {
  return repo(t).createCuenta({ ...b, empresaId: empresaIdOrThrow(t) });
}
export async function getCuenta(t: TenantContext, id: string) {
  const r = repo(t);
  const cuenta = await r.findCuenta(id);
  if (!cuenta) throw new HttpError(404, "Cuenta no encontrada");
  const [ing, egr, sf, nom] = await r.cuentaSums(cuenta.id);
  const saldoActual = num(cuenta.saldoInicial) + num(ing._sum.valorRecibido) - num(egr._sum.valorGasto) - num(sf._sum.valorFacturado) - num(nom._sum.valorNetoPagar);
  return { ...cuenta, saldoActual };
}
export async function updateCuenta(t: TenantContext, id: string, b: In<typeof updateCuentaSchema>) {
  const r = repo(t);
  if ((await r.updateCuenta(id, b)) === 0) throw new HttpError(404, "Cuenta no encontrada");
  return r.findCuentaById(id);
}
export async function deleteCuenta(t: TenantContext, id: string): Promise<void> {
  const r = repo(t);
  const cuenta = await r.findCuentaSelectId(id);
  if (!cuenta) throw new HttpError(404, "Cuenta no encontrada");
  const [ing, egr, nom, sf, rec] = await r.cuentaMovimientoCounts(cuenta.id);
  if (ing + egr + nom + sf + rec > 0) {
    throw new HttpError(409, "No se puede borrar: la cuenta tiene movimientos asociados. Desactívala (estado INACTIVA) en su lugar.");
  }
  await r.deleteCuenta(cuenta.id);
}

// ===================== CARTERA =====================
function totalDesdePlan(config: any, contrato: any): number | null {
  if (config) {
    switch (config.modalidadCobro) {
      case "FIJO": return config.valorFijo != null ? num(config.valorFijo) : null;
      case "CUOTALITIS":
      case "CUOTA_MIXTA": {
        const total = (config.numeroCuotas ?? 0) * num(config.valorCuota) + num(config.valorFijo);
        return total > 0 ? total : null;
      }
      case "PRIMA_EXITO": return null;
      default: return config.valorFijo != null ? num(config.valorFijo) : null;
    }
  }
  return contrato.valorAcordado != null ? num(contrato.valorAcordado) : null;
}
export async function listCartera(t: TenantContext, clienteId?: string, page?: PageParams | null) {
  const r = repo(t);
  if (!page) {
    const filas = await r.listCartera(clienteId);
    return Promise.all(filas.map(conSaldo));
  }
  const [total, filas] = await r.listCarteraPaginated(clienteId, page);
  const items = await Promise.all(filas.map(conSaldo));
  return paginated(items, total, page);
}
export async function createCartera(t: TenantContext, b: In<typeof createCarteraSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const contrato = await r.findContratoComercial(b.contratoId);
  if (!contrato) throw new HttpError(400, "El contrato no pertenece a tu empresa");
  const config = await r.findConfigByContrato(contrato.id);
  try {
    const cartera = await r.createCartera({
      empresaId, clienteId: contrato.clienteId, procesoId: b.procesoId,
      contratoId: contrato.id, configuracionCobroId: config?.id,
      valorTotalAcordado: totalDesdePlan(config, contrato),
      tipoCobro: config?.modalidadCobro ?? contrato.tipoCobroAcordado,
      fechaProximoPago: config?.fechaPrimerPago,
      responsableId: b.responsableId, observaciones: b.observaciones,
    });
    return await conSaldo(cartera);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe una cartera para ese contrato");
    }
    throw err;
  }
}
export async function resyncCartera(t: TenantContext, id: string) {
  const r = repo(t);
  const cartera = await r.findCartera(id);
  if (!cartera) throw new HttpError(404, "Cartera no encontrada");
  const config = cartera.configuracionCobroId ? await r.findConfigById(cartera.configuracionCobroId) : null;
  const contrato = cartera.contratoId ? await r.findContratoComercialById(cartera.contratoId) : null;
  const actualizada = await r.updateCartera(cartera.id, {
    valorTotalAcordado: totalDesdePlan(config, contrato ?? {}),
    tipoCobro: config?.modalidadCobro ?? cartera.tipoCobro,
    fechaProximoPago: config?.fechaPrimerPago ?? cartera.fechaProximoPago,
  });
  return conSaldo(actualizada);
}

// ===================== REPORTES =====================
export async function reporte(t: TenantContext, periodo: string) {
  const inicio = new Date(`${periodo}-01T00:00:00`);
  const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
  const [ingresos, egresos, nomina, servicios, cajaSal] = await repo(t).reporteSums(periodo, { gte: inicio, lt: fin });
  const totalIngresos = num(ingresos._sum.valorRecibido);
  const totalEgresos = num(egresos._sum.valorGasto) + num(nomina._sum.valorNetoPagar) + num(servicios._sum.valorFacturado) + num(cajaSal._sum.valor);
  return {
    periodo, totalIngresos, totalEgresos, utilidadNeta: totalIngresos - totalEgresos,
    desglose: {
      egresosGenerales: num(egresos._sum.valorGasto),
      nomina: num(nomina._sum.valorNetoPagar),
      serviciosFijos: num(servicios._sum.valorFacturado),
      cajaMenor: num(cajaSal._sum.valor),
    },
  };
}
