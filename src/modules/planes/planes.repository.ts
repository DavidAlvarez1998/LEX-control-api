// Acceso a datos de Planes (plataforma; sin empresaId). Acepta un client opcional
// para correr dentro de la transacción del servicio (create/update reemplazan sets).
import { Prisma, type RolEmpresa } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

const incl = { modulos: { include: { modulo: { select: { clave: true } } } }, cuotas: true } as const;

export class PlanesRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  listModulos() {
    return this.db.modulo.findMany({
      orderBy: { orden: "asc" },
      select: { id: true, clave: true, nombre: true, esBaseline: true },
    });
  }

  listEmpresasConSuscripcion() {
    return this.db.empresa.findMany({
      orderBy: { nombre: "asc" },
      select: {
        id: true, nombre: true, activo: true,
        suscripcion: { select: { estado: true, plan: { select: { clave: true, nombre: true } } } },
      },
    });
  }

  findPlanById(id: string) {
    return this.db.plan.findUnique({ where: { id }, select: { id: true } });
  }
  findEmpresaById(id: string) {
    return this.db.empresa.findUnique({ where: { id }, select: { id: true } });
  }
  upsertSuscripcion(empresaId: string, planId: string) {
    return this.db.suscripcion.upsert({
      where: { empresaId },
      update: { planId, estado: "ACTIVA" },
      create: { empresaId, planId, estado: "ACTIVA" },
    });
  }

  listPlanes() {
    return this.db.plan.findMany({ orderBy: { orden: "asc" }, include: incl });
  }
  findPlanFull(id: string) {
    return this.db.plan.findUniqueOrThrow({ where: { id }, include: incl });
  }

  /** Claves de módulos NO-baseline → ids (ignora baseline / inexistentes). */
  async moduloIdsNoBaseline(claves: string[]): Promise<string[]> {
    const mods = await this.db.modulo.findMany({ where: { clave: { in: claves }, esBaseline: false }, select: { id: true } });
    return mods.map((m) => m.id);
  }

  createPlan(data: { clave: string; nombre: string; precioMensual: number; orden: number; activo: boolean }) {
    return this.db.plan.create({ data });
  }
  updatePlan(id: string, data: Prisma.PlanUncheckedUpdateInput) {
    return this.db.plan.update({ where: { id }, data });
  }
  createPlanModulo(planId: string, moduloId: string) {
    return this.db.planModulo.create({ data: { planId, moduloId } });
  }
  deletePlanModulos(planId: string) {
    return this.db.planModulo.deleteMany({ where: { planId } });
  }
  createPlanCuota(planId: string, rolEmpresa: RolEmpresa, limite: number | null) {
    return this.db.planCuota.create({ data: { planId, rolEmpresa, limite } });
  }
  deletePlanCuotas(planId: string) {
    return this.db.planCuota.deleteMany({ where: { planId } });
  }
}
