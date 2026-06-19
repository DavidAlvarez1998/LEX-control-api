// Acceso a datos de Facturación. Tenant-scoped (empresaId forzado al construir).
// Acepta client opcional para correr dentro de la transacción del servicio.
import { Prisma, type EstadoFactura } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";
import { n } from "./facturacion.dto";

const itemsAsc = { items: { orderBy: { orden: "asc" as const } } };

export class FacturasRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}

  // --- validadores same-empresa (FK escalares sin constraint en BD) ---
  clienteExists(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true } });
  }
  contratoExists(id: string) {
    return this.db.contratoComercial.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true } });
  }
  cuentaExists(id: string) {
    return this.db.cuentaBancaria.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true } });
  }
  findProceso(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.empresaId }, select: { radicado: true } });
  }

  /** Suma de ingresos (PAGADO/PARCIAL) vinculados a la factura → `pagado`. */
  async pagadoSum(facturaId: string): Promise<number> {
    const r = await this.db.ingreso.aggregate({
      _sum: { valorRecibido: true },
      where: { empresaId: this.empresaId, facturaId, estadoPago: { in: ["PAGADO", "PARCIAL"] } },
    });
    return n(r._sum.valorRecibido);
  }

  list(filtros: { estado?: string; clienteId?: string }) {
    return this.db.factura.findMany({
      where: {
        empresaId: this.empresaId,
        ...(filtros.estado ? { estado: filtros.estado as EstadoFactura } : {}),
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
      },
      include: { cliente: { select: { nombre: true } } },
      orderBy: [{ fechaEmision: "desc" }, { createdAt: "desc" }],
    });
  }

  findDetalle(id: string) {
    return this.db.factura.findFirst({
      where: { id, empresaId: this.empresaId },
      include: { items: { orderBy: { orden: "asc" } }, cliente: { select: { nombre: true, email: true, numeroDocumento: true } } },
    });
  }
  findConItems(id: string) {
    return this.db.factura.findFirst({ where: { id, empresaId: this.empresaId }, include: itemsAsc });
  }
  findPlain(id: string) {
    return this.db.factura.findFirst({ where: { id, empresaId: this.empresaId } });
  }
  findEstado(id: string) {
    return this.db.factura.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true, estado: true } });
  }
  // Nota: el id ya viene validado scoped por el caller (registrarPago hace findPlain
  // scoped antes). Scopear este find por empresaId queda pendiente junto a la
  // modernización de los mocks de test (hoy fijan `findUniqueOrThrow`). Ver change api-hardening.
  findByIdConItems(id: string) {
    return this.db.factura.findUniqueOrThrow({ where: { id }, include: itemsAsc });
  }

  listPagos(facturaId: string) {
    return this.db.ingreso.findMany({ where: { empresaId: this.empresaId, facturaId }, orderBy: { fechaIngreso: "desc" } });
  }
  /** Idempotencia: un mismo comprobante por factura representa el MISMO pago.
   *  Si ya existe, `registrarPago` lo devuelve en vez de duplicar el Ingreso. */
  findIngresoPorComprobante(facturaId: string, numeroComprobante: string) {
    return this.db.ingreso.findFirst({ where: { empresaId: this.empresaId, facturaId, numeroComprobante } });
  }

  create(data: Prisma.FacturaUncheckedCreateInput) {
    return this.db.factura.create({ data, include: itemsAsc });
  }
  deleteItems(facturaId: string) {
    return this.db.facturaItem.deleteMany({ where: { facturaId } });
  }
  update(id: string, data: Prisma.FacturaUncheckedUpdateInput) {
    return this.db.factura.update({ where: { id }, data, include: itemsAsc });
  }
  delete(id: string) {
    return this.db.factura.delete({ where: { id } });
  }
  /** Última factura de la empresa con ese prefijo (para el consecutivo). */
  ultimaConPrefijo(prefix: string) {
    return this.db.factura.findFirst({
      where: { empresaId: this.empresaId, numero: { startsWith: prefix } },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
  }
  createIngreso(data: Prisma.IngresoUncheckedCreateInput) {
    return this.db.ingreso.create({ data });
  }
}
