// Acceso a datos de Servicios (catálogo GLOBAL de plataforma — sin empresaId).
import { prisma, type PrismaLike } from "../../shared/prisma";

export class ServiciosRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  list() {
    return this.db.servicio.findMany({ orderBy: { createdAt: "desc" } });
  }
  findById(id: string) {
    return this.db.servicio.findUnique({ where: { id } });
  }
  create(data: Record<string, unknown>) {
    return this.db.servicio.create({ data: data as never });
  }
  update(id: string, data: Record<string, unknown>) {
    return this.db.servicio.update({ where: { id }, data: data as never });
  }
  delete(id: string) {
    return this.db.servicio.delete({ where: { id } });
  }
}
