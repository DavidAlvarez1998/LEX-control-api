// Acceso a datos de los endpoints públicos (landing; sin auth/tenant). Proyección
// MÍNIMA (nada de ids internos/suscripciones/empresa).
import { prisma, type PrismaLike } from "../../shared/prisma";

export class PublicoRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  listPlanesActivos() {
    return this.db.plan.findMany({
      where: { activo: true },
      orderBy: { orden: "asc" },
      select: {
        clave: true, nombre: true, descripcion: true, precioMensual: true,
        modulos: { select: { modulo: { select: { clave: true } } } },
        cuotas: { select: { rolEmpresa: true, limite: true } },
      },
    });
  }
  findPlanByClave(clave: string) {
    return this.db.plan.findUnique({ where: { clave }, select: { id: true } });
  }
  createProspecto(data: Record<string, unknown>) {
    return this.db.prospecto.create({ data: data as never });
  }
}
