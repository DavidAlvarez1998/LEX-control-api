// Acceso a datos del módulo Contable. Tenant-scoped (empresaId forzado al construir).
// Agrupa todas las queries de ingresos/egresos/nómina/caja/servicios-fijos/cuentas/
// cartera/reportes; los saldos se DERIVAN en el service a partir de estas sumas.
import { Prisma, type CategoriaEgreso } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";
import type { PageParams } from "../../shared/pagination";

export class ContableRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}
  private get e() {
    return this.empresaId;
  }

  // --- validadores same-empresa ---
  clienteExists(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  findProceso(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, select: { radicado: true } });
  }
  cuentaExists(id: string) {
    return this.db.cuentaBancaria.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  empleadoExists(id: string) {
    return this.db.usuario.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }

  // --- ingresos ---
  private whereIngresos(f: { clienteId?: string; procesoId?: string }): Prisma.IngresoWhereInput {
    return { empresaId: this.e, ...(f.clienteId ? { clienteId: f.clienteId } : {}), ...(f.procesoId ? { procesoId: f.procesoId } : {}) };
  }
  listIngresos(f: { clienteId?: string; procesoId?: string }) {
    return this.db.ingreso.findMany({ where: this.whereIngresos(f), orderBy: { fechaIngreso: "desc" } });
  }
  listIngresosPaginated(f: { clienteId?: string; procesoId?: string }, p: PageParams) {
    const where = this.whereIngresos(f);
    return Promise.all([
      this.db.ingreso.count({ where }),
      this.db.ingreso.findMany({ where, orderBy: { fechaIngreso: "desc" }, skip: p.skip, take: p.take }),
    ]);
  }
  createIngreso(data: Prisma.IngresoUncheckedCreateInput) {
    return this.db.ingreso.create({ data });
  }

  // --- egresos ---
  private whereEgresos(f: { categoria?: string; procesoId?: string }): Prisma.EgresoWhereInput {
    return { empresaId: this.e, ...(f.categoria ? { categoriaGasto: f.categoria as CategoriaEgreso } : {}), ...(f.procesoId ? { procesoId: f.procesoId } : {}) };
  }
  listEgresos(f: { categoria?: string; procesoId?: string }) {
    return this.db.egreso.findMany({ where: this.whereEgresos(f), orderBy: { fechaGasto: "desc" } });
  }
  listEgresosPaginated(f: { categoria?: string; procesoId?: string }, p: PageParams) {
    const where = this.whereEgresos(f);
    return Promise.all([
      this.db.egreso.count({ where }),
      this.db.egreso.findMany({ where, orderBy: { fechaGasto: "desc" }, skip: p.skip, take: p.take }),
    ]);
  }
  createEgreso(data: Prisma.EgresoUncheckedCreateInput) {
    return this.db.egreso.create({ data });
  }
  async updateEgreso(id: string, data: Prisma.EgresoUncheckedUpdateInput) {
    return (await this.db.egreso.updateMany({ where: { id, empresaId: this.e }, data })).count;
  }
  findEgreso(id: string) {
    return this.db.egreso.findUnique({ where: { id } });
  }

  // --- nómina ---
  listNominas(periodo?: string) {
    return this.db.nomina.findMany({ where: { empresaId: this.e, ...(periodo ? { periodo } : {}) }, orderBy: { periodo: "desc" } });
  }
  listEmpleables() {
    return this.db.contrato.findMany({
      where: { empresaId: this.e },
      select: { id: true, usuarioId: true, nombreCompleto: true, cargo: true, honorarios: true, tipoContrato: true, fechaInicio: true, estado: true },
      orderBy: [{ estado: "asc" }, { nombreCompleto: "asc" }],
    });
  }
  createNomina(data: Prisma.NominaUncheckedCreateInput) {
    return this.db.nomina.create({ data });
  }
  async updateNomina(id: string, data: Prisma.NominaUncheckedUpdateInput) {
    return (await this.db.nomina.updateMany({ where: { id, empresaId: this.e }, data })).count;
  }
  findNomina(id: string) {
    return this.db.nomina.findUnique({ where: { id } });
  }

  // --- caja menor ---
  listCajas() {
    return this.db.cajaMenor.findMany({ where: { empresaId: this.e }, orderBy: { createdAt: "desc" } });
  }
  cajaMovsGroupBy() {
    return this.db.cajaMenorMovimiento.groupBy({ by: ["cajaId", "tipoMovimiento"], _sum: { valor: true }, where: { empresaId: this.e } });
  }
  createCaja(data: Prisma.CajaMenorUncheckedCreateInput) {
    return this.db.cajaMenor.create({ data });
  }
  findCaja(id: string) {
    return this.db.cajaMenor.findFirst({ where: { id, empresaId: this.e } });
  }
  findCajaEstado(id: string) {
    return this.db.cajaMenor.findFirst({ where: { id, empresaId: this.e }, select: { id: true, estado: true } });
  }
  findCajaById(id: string) {
    return this.db.cajaMenor.findUnique({ where: { id } });
  }
  listCajaMovs(cajaId: string) {
    return this.db.cajaMenorMovimiento.findMany({ where: { cajaId }, orderBy: { fechaMovimiento: "asc" } });
  }
  createMovimiento(data: Prisma.CajaMenorMovimientoUncheckedCreateInput) {
    return this.db.cajaMenorMovimiento.create({ data });
  }
  async updateCaja(id: string, data: Prisma.CajaMenorUncheckedUpdateInput) {
    return (await this.db.cajaMenor.updateMany({ where: { id, empresaId: this.e }, data })).count;
  }

  // --- servicios fijos ---
  listServiciosFijos(periodo?: string) {
    return this.db.servicioFijo.findMany({ where: { empresaId: this.e, ...(periodo ? { periodo } : {}) }, orderBy: { periodo: "desc" } });
  }
  createServicioFijo(data: Prisma.ServicioFijoUncheckedCreateInput) {
    return this.db.servicioFijo.create({ data });
  }
  createManyServicioFijo(data: Prisma.ServicioFijoUncheckedCreateInput[]) {
    return this.db.servicioFijo.createMany({ data, skipDuplicates: true });
  }
  async updateServicioFijo(id: string, data: Prisma.ServicioFijoUncheckedUpdateInput) {
    return (await this.db.servicioFijo.updateMany({ where: { id, empresaId: this.e }, data })).count;
  }
  findServicioFijo(id: string) {
    return this.db.servicioFijo.findUnique({ where: { id } });
  }

  // --- servicios fijos recurrentes (plantillas) ---
  listRecurrentes() {
    return this.db.servicioFijoRecurrente.findMany({ where: { empresaId: this.e }, orderBy: [{ activo: "desc" }, { proveedor: "asc" }] });
  }
  listRecurrentesActivas() {
    return this.db.servicioFijoRecurrente.findMany({ where: { empresaId: this.e, activo: true } });
  }
  createRecurrente(data: Prisma.ServicioFijoRecurrenteUncheckedCreateInput) {
    return this.db.servicioFijoRecurrente.create({ data });
  }
  async updateRecurrente(id: string, data: Prisma.ServicioFijoRecurrenteUncheckedUpdateInput) {
    return (await this.db.servicioFijoRecurrente.updateMany({ where: { id, empresaId: this.e }, data })).count;
  }
  findRecurrente(id: string) {
    return this.db.servicioFijoRecurrente.findUnique({ where: { id } });
  }

  // --- cuentas / bolsas ---
  listCuentas() {
    return this.db.cuentaBancaria.findMany({ where: { empresaId: this.e }, orderBy: { createdAt: "desc" } });
  }
  createCuenta(data: Prisma.CuentaBancariaUncheckedCreateInput) {
    return this.db.cuentaBancaria.create({ data });
  }
  findCuenta(id: string) {
    return this.db.cuentaBancaria.findFirst({ where: { id, empresaId: this.e } });
  }
  findCuentaSelectId(id: string) {
    return this.db.cuentaBancaria.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  findCuentaById(id: string) {
    return this.db.cuentaBancaria.findUnique({ where: { id } });
  }
  async updateCuenta(id: string, data: Prisma.CuentaBancariaUncheckedUpdateInput) {
    return (await this.db.cuentaBancaria.updateMany({ where: { id, empresaId: this.e }, data })).count;
  }
  deleteCuenta(id: string) {
    return this.db.cuentaBancaria.delete({ where: { id } });
  }
  /** Sumas de saldo por cuenta (groupBy en lote, evita N+1). */
  cuentasSums() {
    const e = this.e;
    return Promise.all([
      this.db.ingreso.groupBy({ by: ["cuentaId"], _sum: { valorRecibido: true }, where: { empresaId: e, cuentaId: { not: null }, estadoPago: { in: ["PAGADO", "PARCIAL"] } } }),
      this.db.egreso.groupBy({ by: ["cuentaId"], _sum: { valorGasto: true }, where: { empresaId: e, cuentaId: { not: null }, estadoGasto: "PAGADO" } }),
      this.db.servicioFijo.groupBy({ by: ["cuentaId"], _sum: { valorFacturado: true }, where: { empresaId: e, cuentaId: { not: null }, estadoPago: "PAGADO" } }),
      this.db.nomina.groupBy({ by: ["cuentaId"], _sum: { valorNetoPagar: true }, where: { empresaId: e, cuentaId: { not: null }, estadoPago: "PAGADO" } }),
    ]);
  }
  /** Sumas de saldo de UNA cuenta. */
  cuentaSums(cuentaId: string) {
    const e = this.e;
    return Promise.all([
      this.db.ingreso.aggregate({ _sum: { valorRecibido: true }, where: { empresaId: e, cuentaId, estadoPago: { in: ["PAGADO", "PARCIAL"] } } }),
      this.db.egreso.aggregate({ _sum: { valorGasto: true }, where: { empresaId: e, cuentaId, estadoGasto: "PAGADO" } }),
      this.db.servicioFijo.aggregate({ _sum: { valorFacturado: true }, where: { empresaId: e, cuentaId, estadoPago: "PAGADO" } }),
      this.db.nomina.aggregate({ _sum: { valorNetoPagar: true }, where: { empresaId: e, cuentaId, estadoPago: "PAGADO" } }),
    ]);
  }
  /** Conteo de movimientos que referencian la cuenta (gate de borrado). */
  cuentaMovimientoCounts(cuentaId: string) {
    const e = this.e;
    return Promise.all([
      this.db.ingreso.count({ where: { empresaId: e, cuentaId } }),
      this.db.egreso.count({ where: { empresaId: e, cuentaId } }),
      this.db.nomina.count({ where: { empresaId: e, cuentaId } }),
      this.db.servicioFijo.count({ where: { empresaId: e, cuentaId } }),
      this.db.servicioFijoRecurrente.count({ where: { empresaId: e, cuentaId } }),
    ]);
  }

  // --- cartera ---
  private whereCartera(clienteId?: string): Prisma.CarteraWhereInput {
    return { empresaId: this.e, ...(clienteId ? { clienteId } : {}) };
  }
  listCartera(clienteId?: string) {
    return this.db.cartera.findMany({ where: this.whereCartera(clienteId), orderBy: { createdAt: "desc" } });
  }
  listCarteraPaginated(clienteId: string | undefined, p: PageParams) {
    const where = this.whereCartera(clienteId);
    return Promise.all([
      this.db.cartera.count({ where }),
      this.db.cartera.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    ]);
  }
  findContratoComercial(id: string) {
    return this.db.contratoComercial.findFirst({
      where: { id, empresaId: this.e },
      select: { id: true, clienteId: true, tipoCobroAcordado: true, valorAcordado: true },
    });
  }
  findContratoComercialById(id: string) {
    return this.db.contratoComercial.findUnique({ where: { id }, select: { valorAcordado: true, tipoCobroAcordado: true } });
  }
  findConfigByContrato(contratoId: string) {
    return this.db.configuracionCobro.findUnique({ where: { contratoId } });
  }
  findConfigById(id: string) {
    return this.db.configuracionCobro.findUnique({ where: { id } });
  }
  createCartera(data: Prisma.CarteraUncheckedCreateInput) {
    return this.db.cartera.create({ data });
  }
  findCartera(id: string) {
    return this.db.cartera.findFirst({ where: { id, empresaId: this.e } });
  }
  updateCartera(id: string, data: Prisma.CarteraUncheckedUpdateInput) {
    return this.db.cartera.update({ where: { id }, data });
  }

  // --- reportes (mensual) ---
  reporteSums(periodo: string, rango: { gte: Date; lt: Date }) {
    const e = this.e;
    return Promise.all([
      this.db.ingreso.aggregate({ _sum: { valorRecibido: true }, where: { empresaId: e, fechaIngreso: rango, estadoPago: { in: ["PAGADO", "PARCIAL"] } } }),
      this.db.egreso.aggregate({ _sum: { valorGasto: true }, where: { empresaId: e, fechaGasto: rango, estadoGasto: "PAGADO" } }),
      this.db.nomina.aggregate({ _sum: { valorNetoPagar: true }, where: { empresaId: e, periodo, estadoPago: "PAGADO" } }),
      this.db.servicioFijo.aggregate({ _sum: { valorFacturado: true }, where: { empresaId: e, periodo, estadoPago: "PAGADO" } }),
      this.db.cajaMenorMovimiento.aggregate({ _sum: { valor: true }, where: { empresaId: e, tipoMovimiento: "SALIDA", fechaMovimiento: rango } }),
    ]);
  }
}
