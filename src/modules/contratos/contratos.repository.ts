// Acceso a datos de Contratos (RRHH del personal). El ámbito (plataforma=empresaId
// null / empresa=empresaId) lo decide el service y se pasa como filtro `where`.
import { prisma, type PrismaLike } from "../../shared/prisma";

const includeDocs = { documentos: { orderBy: { createdAt: "desc" as const } } };

export class ContratosRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  listByUsuario(usuarioId: string) {
    return this.db.contrato.findMany({ where: { usuarioId }, include: includeDocs, orderBy: { createdAt: "desc" } });
  }
  listByWhere(where: Record<string, unknown>) {
    return this.db.contrato.findMany({ where: where as never, include: includeDocs, orderBy: { createdAt: "desc" } });
  }
  reportes(where: Record<string, unknown>, ahora: Date, limite: Date) {
    return Promise.all([
      this.db.contrato.count({ where: where as never }),
      this.db.contrato.groupBy({ by: ["estado"], where: where as never, _count: { estado: true } }),
      this.db.contrato.findMany({
        where: { ...where, estado: "ACTIVO", fechaFin: { gte: ahora, lte: limite } } as never,
        select: { id: true, nombreCompleto: true, fechaFin: true },
        orderBy: { fechaFin: "asc" },
      }),
    ]);
  }
  create(data: Record<string, unknown>) {
    return this.db.contrato.create({ data: data as never, include: includeDocs });
  }
  findById(id: string) {
    return this.db.contrato.findUnique({ where: { id }, include: includeDocs });
  }
  findEmpresaId(id: string) {
    return this.db.contrato.findUnique({ where: { id }, select: { empresaId: true } });
  }
  findParaDoc(id: string) {
    return this.db.contrato.findUnique({ where: { id }, select: { id: true, empresaId: true, usuarioId: true, numeroDocumento: true } });
  }
  findDuenoYAmbito(id: string) {
    return this.db.contrato.findUnique({ where: { id }, select: { empresaId: true, usuarioId: true } });
  }
  update(id: string, data: Record<string, unknown>) {
    return this.db.contrato.update({ where: { id }, data: data as never, include: includeDocs });
  }
  delete(id: string) {
    return this.db.contrato.delete({ where: { id } });
  }
  usuarioEmpresaId(id: string) {
    return this.db.usuario.findUnique({ where: { id }, select: { empresaId: true } });
  }
  createDocumento(data: Record<string, unknown>) {
    return this.db.documentoContrato.create({ data: data as never });
  }
  async deleteDocumento(docId: string, contratoId: string): Promise<number> {
    return (await this.db.documentoContrato.deleteMany({ where: { id: docId, contratoId } })).count;
  }
}
