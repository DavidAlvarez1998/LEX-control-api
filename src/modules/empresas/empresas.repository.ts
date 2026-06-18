// Acceso a datos de Empresas (gestión ADMIN de plataforma; sin scoping por tenant).
// Acepta client opcional para correr dentro de la transacción del servicio.
import { prisma, type PrismaLike } from "../../shared/prisma";

const empresaConServicios = { servicios: { include: { servicio: true } } } as const;

export class EmpresasRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  list() {
    return this.db.empresa.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { usuarios: true, servicios: true } },
        servicios: {
          orderBy: { servicio: { nombre: "asc" } },
          select: { servicio: { select: { nombre: true } } },
        },
      },
    });
  }

  findById(id: string) {
    return this.db.empresa.findUnique({
      where: { id },
      include: { usuarios: true, servicios: { include: { servicio: true } } },
    });
  }

  /** Servicios del catálogo por id (para validar/rellenar precios de asignaciones). */
  findCatalogByIds(ids: string[]) {
    return this.db.servicio.findMany({ where: { id: { in: ids } } });
  }

  create(data: Record<string, unknown>) {
    return this.db.empresa.create({ data: data as never });
  }
  update(id: string, data: Record<string, unknown>) {
    return this.db.empresa.update({ where: { id }, data: data as never });
  }
  delete(id: string) {
    return this.db.empresa.delete({ where: { id } });
  }
  findFull(id: string) {
    return this.db.empresa.findUnique({ where: { id }, include: empresaConServicios });
  }

  createManyEmpresaServicio(rows: Record<string, unknown>[]) {
    return this.db.empresaServicio.createMany({ data: rows as never });
  }
  deleteEmpresaServiciosNotIn(empresaId: string, servicioIds: string[]) {
    return this.db.empresaServicio.deleteMany({ where: { empresaId, servicioId: { notIn: servicioIds } } });
  }
  upsertEmpresaServicio(
    empresaId: string,
    servicioId: string,
    create: Record<string, unknown>,
    update: Record<string, unknown>,
  ) {
    return this.db.empresaServicio.upsert({
      where: { empresaId_servicioId: { empresaId, servicioId } },
      create: create as never,
      update: update as never,
    });
  }
}
