// Acceso a datos del Catálogo (áreas, tipos de proceso, plantillas). Catálogo
// HÍBRIDO (global empresaId=null + propio del despacho): la visibilidad/autorización
// la decide el service; el repo expone las queries (acepta client para tx).
import type { Prisma } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

export const tipoInclude = { areas: { include: { area: true } } } as const;

export class CatalogRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  // --- Áreas ---
  listAreas(verTodas: boolean) {
    return this.db.areaPractica.findMany({
      where: verTodas ? {} : { activo: true },
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    });
  }
  findAreaById(id: string) {
    return this.db.areaPractica.findUnique({ where: { id } });
  }
  findAreaWithTipoCount(id: string) {
    return this.db.areaPractica.findUnique({ where: { id }, include: { _count: { select: { tipos: true } } } });
  }
  findAreaBySlug(slug: string) {
    return this.db.areaPractica.findUnique({ where: { slug } });
  }
  findAreasBySlugs(slugs: string[]) {
    return this.db.areaPractica.findMany({ where: { slug: { in: slugs } } });
  }
  maxAreaOrden() {
    return this.db.areaPractica.aggregate({ _max: { orden: true } });
  }
  createArea(data: Record<string, unknown>) {
    return this.db.areaPractica.create({ data: data as never });
  }
  updateArea(id: string, data: Record<string, unknown>) {
    return this.db.areaPractica.update({ where: { id }, data: data as never });
  }
  deleteArea(id: string) {
    return this.db.areaPractica.delete({ where: { id } });
  }

  // --- Tipos de proceso ---
  listTipos(where: Prisma.TipoProcesoWhereInput) {
    return this.db.tipoProceso.findMany({ where, include: tipoInclude, orderBy: { nombre: "asc" } });
  }
  findTipoById(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id }, include: tipoInclude });
  }
  findTipoRaw(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id } });
  }
  createTipo(data: Record<string, unknown>) {
    return this.db.tipoProceso.create({ data: data as never, include: tipoInclude });
  }
  updateTipo(id: string, data: Record<string, unknown>) {
    return this.db.tipoProceso.update({ where: { id }, data: data as never, include: tipoInclude });
  }
  deleteTipoAreas(tipoProcesoId: string) {
    return this.db.tipoProcesoArea.deleteMany({ where: { tipoProcesoId } });
  }
  deleteTipo(id: string) {
    return this.db.tipoProceso.delete({ where: { id } });
  }
  findGlobalTiposByNombre(nombres: string[]) {
    return this.db.tipoProceso.findMany({ where: { empresaId: null, nombre: { in: nombres } }, select: { nombre: true } });
  }

  // --- Plantillas de documento ---
  listPlantillas(tipoProcesoId: string) {
    return this.db.plantillaDocumento.findMany({ where: { tipoProcesoId }, orderBy: { nombre: "asc" } });
  }
  findPlantillaById(id: string) {
    return this.db.plantillaDocumento.findUnique({ where: { id } });
  }
  createPlantilla(data: { tipoProcesoId: string; nombre: string; contenido: string }) {
    return this.db.plantillaDocumento.create({ data });
  }
  updatePlantilla(id: string, data: Record<string, unknown>) {
    return this.db.plantillaDocumento.update({ where: { id }, data: data as never });
  }
  deletePlantilla(id: string) {
    return this.db.plantillaDocumento.delete({ where: { id } });
  }
}
