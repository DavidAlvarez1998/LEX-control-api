// Casos de uso del Catálogo (áreas, tipos de proceso, plantillas). Catálogo híbrido:
// global (ADMIN) + propio del despacho (esAdminEmpresa). La visibilidad y la
// autorización viven aquí (toman TenantContext). Sin Express.
import { Prisma, Rol } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { CatalogRepository } from "./catalog.repository";
import { serializeCategoria, serializeTipo } from "./catalog.dto";
import type {
  CreateAreaInput, CreateCategoriaInput, CreatePlantillaInput, CreateTipoProcesoInput,
  UpdateAreaInput, UpdateCategoriaInput, UpdatePlantillaInput, UpdateTipoProcesoInput,
} from "./catalog.schemas";

const repo = () => new CatalogRepository();

// ---------- Autorización / visibilidad ----------
function esVisible(tipo: { empresaId: string | null }, empresaId: string | null): boolean {
  return tipo.empresaId === null || tipo.empresaId === empresaId;
}

/** Destino de la creación: global (ADMIN) o del despacho (esAdminEmpresa); si no, 403. */
function destinoCatalogo(t: TenantContext): { empresaId: string | null; empresaKey: string } {
  if (t.rol === Rol.ADMIN) return { empresaId: null, empresaKey: "" };
  if (t.empresaId && t.esAdminEmpresa) return { empresaId: t.empresaId, empresaKey: t.empresaId };
  throw new HttpError(403, "No autorizado para crear tipos de proceso");
}

/** Autoriza editar/eliminar: ADMIN sobre globales, esAdminEmpresa sobre los suyos. */
function autorizarEscritura(t: TenantContext, empresaIdDelTipo: string | null): void {
  if (empresaIdDelTipo === null) {
    if (t.rol !== Rol.ADMIN) throw new HttpError(403, "Solo ADMIN edita tipos globales");
    return;
  }
  if (!(t.esAdminEmpresa && empresaIdDelTipo === empresaIdOrThrow(t))) {
    throw new HttpError(403, "No autorizado");
  }
}

async function resolverAreas(r: CatalogRepository, slugs: string[]): Promise<string[]> {
  const unicos = [...new Set(slugs)];
  const areas = await r.findAreasBySlugs(unicos);
  if (areas.length !== unicos.length) throw new HttpError(400, "Una o más áreas de práctica no existen");
  return areas.map((a) => a.id);
}

async function slugAreaUnico(r: CatalogRepository, nombre: string): Promise<string> {
  const base =
    nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";
  let slug = base;
  for (let i = 2; await r.findAreaBySlug(slug); i++) slug = `${base}-${i}`;
  return slug;
}

async function siguienteOrdenArea(r: CatalogRepository): Promise<number> {
  const max = await r.maxAreaOrden();
  return (max._max.orden ?? 0) + 1;
}

async function slugCategoriaUnico(r: CatalogRepository, nombre: string): Promise<string> {
  const base =
    nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "categoria";
  let slug = base;
  for (let i = 2; await r.findCategoriaBySlug(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/** Valida que la categoría (si se pasa) exista; devuelve el id o null. */
async function resolverCategoria(r: CatalogRepository, categoriaId: string | null | undefined): Promise<string | null> {
  if (!categoriaId) return null;
  const cat = await r.findCategoriaById(categoriaId);
  if (!cat) throw new HttpError(400, "La categoría de proceso no existe");
  return cat.id;
}

/** Toda acción `crearDerivado` debe apuntar a un tipo de proceso GLOBAL existente. */
async function validarAccionesDestino(
  r: CatalogRepository,
  etapas: { accion?: { tipoDestinoNombre?: string } }[],
): Promise<void> {
  const destinos = [...new Set(etapas.flatMap((e) => (e.accion?.tipoDestinoNombre ? [e.accion.tipoDestinoNombre] : [])))];
  if (destinos.length === 0) return;
  const existentes = await r.findGlobalTiposByNombre(destinos);
  const set = new Set(existentes.map((t) => t.nombre));
  const faltan = destinos.filter((n) => !set.has(n));
  if (faltan.length) {
    throw new HttpError(422, `La acción crearDerivado apunta a un tipo global inexistente: ${faltan.join(", ")}`);
  }
}

async function cargarTipoVisible(t: TenantContext, r: CatalogRepository, tipoId: string) {
  const tipo = await r.findTipoRaw(tipoId);
  if (!tipo || !esVisible(tipo, t.empresaId)) throw new HttpError(404, "Tipo de proceso no encontrado");
  return tipo;
}

async function cargarPlantillaEditable(t: TenantContext, r: CatalogRepository, plantillaId: string) {
  const plantilla = await r.findPlantillaById(plantillaId);
  if (!plantilla) throw new HttpError(404, "Plantilla no encontrada");
  const tipo = await cargarTipoVisible(t, r, plantilla.tipoProcesoId);
  autorizarEscritura(t, tipo.empresaId);
  return plantilla;
}

// ---------- Áreas ----------
export function listAreas(t: TenantContext, incluirInactivas: boolean) {
  const verTodas = t.rol === Rol.ADMIN && incluirInactivas;
  return repo().listAreas(verTodas);
}

export async function createArea(input: CreateAreaInput) {
  const r = repo();
  const { nombre, jurisdiccion, tipo, activo, orden } = input;
  const slug = await slugAreaUnico(r, nombre);
  const ordenFinal = orden ?? (await siguienteOrdenArea(r));
  return r.createArea({ slug, nombre, jurisdiccion, tipo, activo, orden: ordenFinal });
}

export async function updateArea(id: string, input: UpdateAreaInput) {
  const r = repo();
  const existe = await r.findAreaById(id);
  if (!existe) throw new HttpError(404, "Área de práctica no encontrada");
  return r.updateArea(id, input);
}

export async function deleteArea(id: string): Promise<void> {
  const r = repo();
  const area = await r.findAreaWithTipoCount(id);
  if (!area) throw new HttpError(404, "Área de práctica no encontrada");
  if (area._count.tipos > 0) {
    throw new HttpError(409, "El área tiene tipos de proceso asociados; desactívala en vez de eliminarla");
  }
  await r.deleteArea(id);
}

// ---------- Categorías (clase de proceso) ----------
export function listCategorias(
  t: TenantContext,
  filtros: { jurisdiccion?: string },
  incluirInactivas: boolean,
) {
  const verTodas = t.rol === Rol.ADMIN && incluirInactivas;
  const where: Prisma.CategoriaProcesoWhereInput = {
    AND: [
      verTodas ? {} : { activo: true },
      filtros.jurisdiccion
        ? { jurisdiccion: filtros.jurisdiccion as Prisma.CategoriaProcesoWhereInput["jurisdiccion"] }
        : {},
    ],
  };
  return repo().listCategorias(where).then((cs) => cs.map(serializeCategoria));
}

export async function createCategoria(input: CreateCategoriaInput) {
  const r = repo();
  const { nombre, jurisdiccion, activo, proximamente, orden } = input;
  const slug = await slugCategoriaUnico(r, nombre);
  const ordenFinal = orden ?? ((await r.maxCategoriaOrden())._max.orden ?? 0) + 1;
  return serializeCategoria(
    await r.createCategoria({ slug, nombre, jurisdiccion, activo, proximamente, orden: ordenFinal }),
  );
}

export async function updateCategoria(id: string, input: UpdateCategoriaInput) {
  const r = repo();
  const existe = await r.findCategoriaById(id);
  if (!existe) throw new HttpError(404, "Categoría no encontrada");
  return serializeCategoria(await r.updateCategoria(id, input));
}

export async function deleteCategoria(id: string): Promise<void> {
  const r = repo();
  const cat = await r.findCategoriaWithTipoCount(id);
  if (!cat) throw new HttpError(404, "Categoría no encontrada");
  if (cat._count.tipos > 0) {
    throw new HttpError(409, "La categoría tiene tipos de proceso asociados; reasígnalos o desactívala");
  }
  await r.deleteCategoria(id);
}

// ---------- Tipos de proceso ----------
export async function listTipos(t: TenantContext, filtros: { area?: string; jurisdiccion?: string }) {
  const empresaId = t.empresaId;
  const visibles: Prisma.TipoProcesoWhereInput = empresaId
    ? { OR: [{ empresaId: null }, { empresaId }] }
    : { empresaId: null };
  const where: Prisma.TipoProcesoWhereInput = {
    AND: [
      visibles,
      { activo: true },
      filtros.area ? { areas: { some: { area: { slug: filtros.area } } } } : {},
      filtros.jurisdiccion ? { jurisdiccion: filtros.jurisdiccion as Prisma.TipoProcesoWhereInput["jurisdiccion"] } : {},
    ],
  };
  const tipos = await repo().listTipos(where);
  return tipos.map(serializeTipo);
}

export async function getTipo(t: TenantContext, id: string) {
  const tipo = await repo().findTipoById(id);
  if (!tipo || !esVisible(tipo, t.empresaId)) throw new HttpError(404, "Tipo de proceso no encontrado");
  return serializeTipo(tipo);
}

export async function createTipo(t: TenantContext, input: CreateTipoProcesoInput) {
  const r = repo();
  const { empresaId, empresaKey } = destinoCatalogo(t);
  const { areaSlugs, ...data } = input;
  const areaIds = await resolverAreas(r, areaSlugs);
  const categoriaId = await resolverCategoria(r, data.categoriaId);
  await validarAccionesDestino(r, data.etapas);
  try {
    const tipo = await r.createTipo({
      nombre: data.nombre,
      nombreVisual: data.nombreVisual ?? null,
      descripcion: data.descripcion,
      jurisdiccion: data.jurisdiccion,
      esJudicial: data.esJudicial ?? true,
      categoriaId,
      esquemaFormulario: data.esquemaFormulario,
      etapas: data.etapas,
      empresaId,
      empresaKey,
      areas: { create: areaIds.map((areaId) => ({ areaId })) },
    });
    return serializeTipo(tipo);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe un tipo de proceso con ese nombre");
    }
    throw err;
  }
}

export async function updateTipo(t: TenantContext, id: string, input: UpdateTipoProcesoInput) {
  const base = repo();
  const actual = await base.findTipoRaw(id);
  if (!actual || !esVisible(actual, t.empresaId)) throw new HttpError(404, "Tipo de proceso no encontrado");
  autorizarEscritura(t, actual.empresaId);
  const { areaSlugs, ...data } = input;
  const areaIds = await resolverAreas(base, areaSlugs);
  const categoriaId = await resolverCategoria(base, data.categoriaId);
  await validarAccionesDestino(base, data.etapas);

  const tipo = await prisma.$transaction(async (tx) => {
    const r = new CatalogRepository(tx);
    await r.deleteTipoAreas(actual.id);
    return r.updateTipo(actual.id, {
      nombre: data.nombre,
      ...(data.nombreVisual !== undefined ? { nombreVisual: data.nombreVisual } : {}),
      descripcion: data.descripcion,
      jurisdiccion: data.jurisdiccion,
      ...(data.esJudicial !== undefined ? { esJudicial: data.esJudicial } : {}),
      ...(data.categoriaId !== undefined ? { categoriaId } : {}),
      esquemaFormulario: data.esquemaFormulario,
      etapas: data.etapas,
      esquemaVersion: { increment: 1 },
      areas: { create: areaIds.map((areaId) => ({ areaId })) },
    });
  });
  return serializeTipo(tipo);
}

export async function deleteTipo(t: TenantContext, id: string): Promise<void> {
  const r = repo();
  const actual = await r.findTipoRaw(id);
  if (!actual || !esVisible(actual, t.empresaId)) throw new HttpError(404, "Tipo de proceso no encontrado");
  autorizarEscritura(t, actual.empresaId);
  try {
    await r.deleteTipo(actual.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2003" || err.code === "P2014")) {
      throw new HttpError(409, "No se puede eliminar: hay procesos de este tipo");
    }
    throw err;
  }
}

// ---------- Plantillas ----------
export async function listPlantillas(t: TenantContext, tipoId: string) {
  const r = repo();
  await cargarTipoVisible(t, r, tipoId);
  return r.listPlantillas(tipoId);
}

export async function createPlantilla(t: TenantContext, tipoId: string, input: CreatePlantillaInput) {
  const r = repo();
  const tipo = await cargarTipoVisible(t, r, tipoId);
  autorizarEscritura(t, tipo.empresaId);
  return r.createPlantilla({ tipoProcesoId: tipo.id, nombre: input.nombre, contenido: input.contenido });
}

export async function updatePlantilla(t: TenantContext, plantillaId: string, input: UpdatePlantillaInput) {
  const r = repo();
  const plantilla = await cargarPlantillaEditable(t, r, plantillaId);
  return r.updatePlantilla(plantilla.id, {
    ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
    ...(input.contenido !== undefined ? { contenido: input.contenido } : {}),
  });
}

export async function deletePlantilla(t: TenantContext, plantillaId: string): Promise<void> {
  const r = repo();
  const plantilla = await cargarPlantillaEditable(t, r, plantillaId);
  await r.deletePlantilla(plantilla.id);
}
