// Acceso a datos del Catálogo (áreas, tipos de proceso, plantillas). Catálogo
// HÍBRIDO (global empresaId=null + propio del despacho): la visibilidad/autorización
// la decide el service; el repo expone las queries (acepta client para tx).
import { Prisma } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

export const tipoInclude = { areas: { include: { area: true } }, categoria: true } as const;

export class CatalogRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  // --- Categorías (clase de proceso) ---
  listCategorias(where: Prisma.CategoriaProcesoWhereInput) {
    return this.db.categoriaProceso.findMany({ where, orderBy: [{ orden: "asc" }, { nombre: "asc" }] });
  }
  findCategoriaById(id: string) {
    return this.db.categoriaProceso.findUnique({ where: { id } });
  }
  findCategoriaWithTipoCount(id: string) {
    return this.db.categoriaProceso.findUnique({ where: { id }, include: { _count: { select: { tipos: true } } } });
  }
  findCategoriaBySlug(slug: string) {
    return this.db.categoriaProceso.findUnique({ where: { slug } });
  }
  maxCategoriaOrden() {
    return this.db.categoriaProceso.aggregate({ _max: { orden: true } });
  }
  createCategoria(data: Prisma.CategoriaProcesoCreateInput) {
    return this.db.categoriaProceso.create({ data });
  }
  updateCategoria(id: string, data: Prisma.CategoriaProcesoUpdateInput) {
    return this.db.categoriaProceso.update({ where: { id }, data });
  }
  deleteCategoria(id: string) {
    return this.db.categoriaProceso.delete({ where: { id } });
  }

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
  createArea(data: Prisma.AreaPracticaCreateInput) {
    return this.db.areaPractica.create({ data });
  }
  updateArea(id: string, data: Prisma.AreaPracticaUpdateInput) {
    return this.db.areaPractica.update({ where: { id }, data });
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
  createTipo(data: Prisma.TipoProcesoUncheckedCreateInput) {
    return this.db.tipoProceso.create({ data, include: tipoInclude });
  }
  updateTipo(id: string, data: Prisma.TipoProcesoUncheckedUpdateInput) {
    return this.db.tipoProceso.update({ where: { id }, data, include: tipoInclude });
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
  updatePlantilla(id: string, data: Prisma.PlantillaDocumentoUpdateInput) {
    return this.db.plantillaDocumento.update({ where: { id }, data });
  }
  deletePlantilla(id: string) {
    return this.db.plantillaDocumento.delete({ where: { id } });
  }
}
