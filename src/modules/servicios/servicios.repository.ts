// Acceso a datos de Servicios (catálogo GLOBAL de plataforma — sin empresaId).
import { Prisma } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

export class ServiciosRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  list() {
    return this.db.servicio.findMany({ orderBy: { createdAt: "desc" } });
  }
  findById(id: string) {
    return this.db.servicio.findUnique({ where: { id } });
  }
  create(data: Prisma.ServicioUncheckedCreateInput) {
    return this.db.servicio.create({ data });
  }
  update(id: string, data: Prisma.ServicioUncheckedUpdateInput) {
    return this.db.servicio.update({ where: { id }, data });
  }
  delete(id: string) {
    return this.db.servicio.delete({ where: { id } });
  }
}
