// Acceso a datos de Empresas (gestión ADMIN de plataforma; sin scoping por tenant).
// Acepta client opcional para correr dentro de la transacción del servicio.
import { Prisma } from "@prisma/client";
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

  create(data: Prisma.EmpresaUncheckedCreateInput) {
    return this.db.empresa.create({ data });
  }
  update(id: string, data: Prisma.EmpresaUncheckedUpdateInput) {
    return this.db.empresa.update({ where: { id }, data });
  }
  delete(id: string) {
    return this.db.empresa.delete({ where: { id } });
  }
  findFull(id: string) {
    return this.db.empresa.findUnique({ where: { id }, include: empresaConServicios });
  }

  createManyEmpresaServicio(rows: Prisma.EmpresaServicioUncheckedCreateInput[]) {
    return this.db.empresaServicio.createMany({ data: rows });
  }
  deleteEmpresaServiciosNotIn(empresaId: string, servicioIds: string[]) {
    return this.db.empresaServicio.deleteMany({ where: { empresaId, servicioId: { notIn: servicioIds } } });
  }
  upsertEmpresaServicio(
    empresaId: string,
    servicioId: string,
    create: Prisma.EmpresaServicioUncheckedCreateInput,
    update: Prisma.EmpresaServicioUncheckedUpdateInput,
  ) {
    return this.db.empresaServicio.upsert({
      where: { empresaId_servicioId: { empresaId, servicioId } },
      create,
      update,
    });
  }
}
