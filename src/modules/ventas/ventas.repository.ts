// Acceso a datos de Ventas (CRM de PLATAFORMA: prospectos+comisiones). Sin tenancy
// por empresa; el alcance por COMERCIAL (scope) lo decide el service y se pasa como
// filtro. Acepta client opcional para la transacción de "ganar".
import { prisma, type PrismaLike } from "../../shared/prisma";
import { Prisma, Rol } from "@prisma/client";

type Scope = { comercialId?: string };

const PROSPECTO_RESUMEN = { id: true, nombreEmpresa: true, nombreContacto: true, estado: true, telefono: true } as const;

export class VentasRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  // --- helpers ---
  findPlan(id: string) {
    return this.db.plan.findUnique({ where: { id }, select: { id: true, precioMensual: true } });
  }
  findComercial(id: string) {
    return this.db.usuario.findFirst({ where: { id, rol: Rol.COMERCIAL }, select: { id: true } });
  }
  findComercialPorcentaje(id: string) {
    return this.db.usuario.findUnique({ where: { id }, select: { porcentajeComision: true } });
  }

  // --- prospectos ---
  listProspectos(where: Prisma.ProspectoWhereInput) {
    return this.db.prospecto.findMany({ where, orderBy: { createdAt: "desc" } });
  }
  createProspecto(data: Prisma.ProspectoUncheckedCreateInput) {
    return this.db.prospecto.create({ data });
  }
  findProspectoScoped(id: string, scope: Scope) {
    return this.db.prospecto.findFirst({ where: { id, ...scope } });
  }
  findProspecto(id: string) {
    return this.db.prospecto.findUnique({ where: { id } });
  }
  comisionByProspecto(prospectoId: string) {
    return this.db.comision.findUnique({ where: { prospectoId } });
  }
  updateProspectoScoped(id: string, scope: Scope, data: Prisma.ProspectoUncheckedUpdateManyInput) {
    return this.db.prospecto.updateMany({ where: { id, ...scope }, data });
  }
  updateProspecto(id: string, data: Prisma.ProspectoUncheckedUpdateInput) {
    return this.db.prospecto.update({ where: { id }, data });
  }
  reassignPendingSeguimientos(prospectoId: string, comercialId: string | null) {
    return this.db.seguimientoProspecto.updateMany({
      where: { prospectoId, completada: false, canceladaEn: null },
      data: { comercialId },
    });
  }
  /** NUEVO → CONTACTADO (idempotente). */
  avanzarAContactado(prospectoId: string) {
    return this.db.prospecto.updateMany({ where: { id: prospectoId, estado: "NUEVO" }, data: { estado: "CONTACTADO" } });
  }

  // --- ganar (tx): empresa + suscripcion + prospecto + comision ---
  createEmpresa(data: Prisma.EmpresaUncheckedCreateInput) {
    return this.db.empresa.create({ data });
  }
  createSuscripcion(data: Prisma.SuscripcionUncheckedCreateInput) {
    return this.db.suscripcion.create({ data });
  }
  createComision(data: Prisma.ComisionUncheckedCreateInput) {
    return this.db.comision.create({ data });
  }

  // --- seguimientos ---
  listSeguimientos(prospectoId: string) {
    return this.db.seguimientoProspecto.findMany({ where: { prospectoId }, orderBy: { createdAt: "desc" } });
  }
  createSeguimiento(data: Prisma.SeguimientoProspectoUncheckedCreateInput) {
    return this.db.seguimientoProspecto.create({ data });
  }
  findSeguimiento(id: string) {
    return this.db.seguimientoProspecto.findUnique({ where: { id } });
  }
  prospectoEnScope(id: string, scope: Scope) {
    return this.db.prospecto.findFirst({ where: { id, ...scope }, select: { id: true } });
  }
  updateSeguimiento(id: string, data: Prisma.SeguimientoProspectoUncheckedUpdateInput) {
    return this.db.seguimientoProspecto.update({ where: { id }, data });
  }
  deleteSeguimiento(id: string) {
    return this.db.seguimientoProspecto.delete({ where: { id } });
  }

  // --- agenda ---
  agendaItems(dueño: Scope, incluirCompletadas: boolean, desde: Date, hasta: Date) {
    const pendiente = { completada: false, canceladaEn: null };
    return this.db.seguimientoProspecto.findMany({
      where: { ...dueño, ...(incluirCompletadas ? {} : pendiente), fechaProgramada: { gte: desde, lte: hasta } },
      orderBy: { fechaProgramada: "asc" },
      include: { prospecto: { select: PROSPECTO_RESUMEN } },
    });
  }
  agendaVencidas(dueño: Scope, desde: Date) {
    return this.db.seguimientoProspecto.findMany({
      where: { ...dueño, completada: false, canceladaEn: null, fechaProgramada: { lt: desde, not: null } },
      orderBy: { fechaProgramada: "asc" },
      include: { prospecto: { select: PROSPECTO_RESUMEN } },
    });
  }

  // --- equipo comercial (ADMIN) ---
  listComerciales() {
    return this.db.usuario.findMany({
      where: { rol: Rol.COMERCIAL },
      select: { id: true, nombre: true, email: true, activo: true, porcentajeComision: true },
      orderBy: { nombre: "asc" },
    });
  }
  prospectosGroupBy(ids: string[]) {
    return this.db.prospecto.groupBy({ by: ["comercialId", "estado"], where: { comercialId: { in: ids } }, _count: { _all: true } });
  }
  seguimientosPendientesGroupBy(ids: string[]) {
    return this.db.seguimientoProspecto.groupBy({ by: ["comercialId"], where: { comercialId: { in: ids }, completada: false, canceladaEn: null }, _count: { _all: true } });
  }

  // --- comisiones ---
  listComisiones(where: Prisma.ComisionWhereInput) {
    return this.db.comision.findMany({ where, orderBy: { createdAt: "desc" } });
  }
  findComisionId(id: string) {
    return this.db.comision.findUnique({ where: { id }, select: { id: true } });
  }
  updateComision(id: string, data: Prisma.ComisionUncheckedUpdateInput) {
    return this.db.comision.update({ where: { id }, data });
  }
}
