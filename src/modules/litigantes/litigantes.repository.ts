// Acceso a datos de Litigantes. empresaId forzado al construir (scoping multi-tenant).
import { Prisma } from "@prisma/client";
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

  create(data: Omit<Prisma.LitiganteUncheckedCreateInput, "empresaId">) {
    return this.db.litigante.create({ data: { ...data, empresaId: this.empresaId } });
  }

  /** Update scoped por empresa; devuelve el nº de filas afectadas (0 = no encontrado). */
  async updateScoped(id: string, data: Prisma.LitiganteUncheckedUpdateManyInput): Promise<number> {
    const { count } = await this.db.litigante.updateMany({
      where: { id, empresaId: this.empresaId },
      data,
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
