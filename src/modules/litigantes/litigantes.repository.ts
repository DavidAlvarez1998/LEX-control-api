// Acceso a datos de Litigantes. empresaId forzado al construir (scoping multi-tenant).
import { prisma, type PrismaLike } from "../../shared/prisma";

const conProcesos = {
  partes: { include: { proceso: { select: { id: true, titulo: true, codigoInterno: true } } } },
} as const;

export class LitigantesRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}

  list(q?: string) {
    return this.db.litigante.findMany({
      where: { empresaId: this.empresaId, ...(q ? { nombre: { contains: q } } : {}) },
      orderBy: { nombre: "asc" },
    });
  }

  /** Litigante del despacho con sus procesos asociados, o null. */
  findById(id: string) {
    return this.db.litigante.findFirst({
      where: { id, empresaId: this.empresaId },
      include: conProcesos,
    });
  }

  /** Existencia scoped (sin include), para gates de update/delete. */
  existsScoped(id: string) {
    return this.db.litigante.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true } });
  }

  create(data: Record<string, unknown>) {
    return this.db.litigante.create({ data: { ...data, empresaId: this.empresaId } as never });
  }

  /** Update scoped por empresa; devuelve el nº de filas afectadas (0 = no encontrado). */
  async updateScoped(id: string, data: Record<string, unknown>): Promise<number> {
    const { count } = await this.db.litigante.updateMany({
      where: { id, empresaId: this.empresaId },
      data: data as never,
    });
    return count;
  }

  findRaw(id: string) {
    return this.db.litigante.findUnique({ where: { id } });
  }

  delete(id: string) {
    return this.db.litigante.delete({ where: { id } });
  }
}
