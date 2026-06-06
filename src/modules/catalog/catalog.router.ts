import { Router } from "express";
import { Prisma, Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import {
  empresaIdRequerido,
  requireAuth,
  requireRole,
} from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  createTipoProcesoSchema,
  tipoIdParams,
  updateTipoProcesoSchema,
} from "./catalog.schemas";

export const catalogRoutes: Router = Router();

const tipoInclude = { areas: { include: { area: true } } } as const;

type TipoConAreas = Prisma.TipoProcesoGetPayload<{ include: typeof tipoInclude }>;

function serializeTipo(t: TipoConAreas) {
  return {
    id: t.id,
    nombre: t.nombre,
    descripcion: t.descripcion,
    jurisdiccion: t.jurisdiccion,
    esquemaFormulario: t.esquemaFormulario,
    etapas: t.etapas,
    esquemaVersion: t.esquemaVersion,
    empresaId: t.empresaId,
    areaSlugs: t.areas.map((a) => a.area.slug),
  };
}

/** GET /catalogo/areas — áreas de práctica activas. */
catalogRoutes.get(
  "/areas",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const areas = await prisma.areaPractica.findMany({
      where: { activo: true },
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    });
    res.json(areas);
  }),
);

/**
 * GET /catalogo/tipos-proceso — tipos visibles para el despacho: globales
 * (empresaId null) + propios. Filtros opcionales `?area=slug`, `?jurisdiccion`.
 */
catalogRoutes.get(
  "/tipos-proceso",
  requireAuth,
  asyncHandler(async (req, res) => {
    const empresaId = req.empresaId ?? null;
    const visibles: Prisma.TipoProcesoWhereInput = empresaId
      ? { OR: [{ empresaId: null }, { empresaId }] }
      : { empresaId: null };

    const where: Prisma.TipoProcesoWhereInput = {
      AND: [
        visibles,
        { activo: true },
        req.query.area ? { areas: { some: { area: { slug: String(req.query.area) } } } } : {},
        req.query.jurisdiccion
          ? { jurisdiccion: req.query.jurisdiccion as Prisma.TipoProcesoWhereInput["jurisdiccion"] }
          : {},
      ],
    };

    const tipos = await prisma.tipoProceso.findMany({
      where,
      include: tipoInclude,
      orderBy: { nombre: "asc" },
    });
    res.json(tipos.map(serializeTipo));
  }),
);

/** GET /catalogo/tipos-proceso/:id — un tipo visible para el despacho. */
catalogRoutes.get(
  "/tipos-proceso/:id",
  requireAuth,
  validate({ params: tipoIdParams }),
  asyncHandler(async (req, res) => {
    const tipo = await prisma.tipoProceso.findUnique({
      where: { id: req.params.id },
      include: tipoInclude,
    });
    if (!tipo || !esVisible(tipo, req.empresaId ?? null)) {
      throw new HttpError(404, "Tipo de proceso no encontrado");
    }
    res.json(serializeTipo(tipo));
  }),
);

/**
 * POST /catalogo/tipos-proceso — crea un tipo. Un ADMIN de plataforma crea uno
 * GLOBAL (empresaId null); un USUARIO con esAdminEmpresa crea uno PROPIO de su
 * despacho. Cualquier otro: 403.
 */
catalogRoutes.post(
  "/tipos-proceso",
  requireAuth,
  validate({ body: createTipoProcesoSchema }),
  asyncHandler(async (req, res) => {
    const { empresaId, empresaKey } = destinoCatalogo(req);
    const { areaSlugs, ...data } = req.body;
    const areaIds = await resolverAreas(areaSlugs);

    try {
      const tipo = await prisma.tipoProceso.create({
        data: {
          nombre: data.nombre,
          descripcion: data.descripcion,
          jurisdiccion: data.jurisdiccion,
          esquemaFormulario: data.esquemaFormulario,
          etapas: data.etapas,
          empresaId,
          empresaKey,
          areas: { create: areaIds.map((areaId) => ({ areaId })) },
        },
        include: tipoInclude,
      });
      res.status(201).json(serializeTipo(tipo));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, "Ya existe un tipo de proceso con ese nombre");
      }
      throw err;
    }
  }),
);

/** PATCH /catalogo/tipos-proceso/:id — edita un tipo y sube su esquemaVersion. */
catalogRoutes.patch(
  "/tipos-proceso/:id",
  requireAuth,
  validate({ params: tipoIdParams, body: updateTipoProcesoSchema }),
  asyncHandler(async (req, res) => {
    const actual = await prisma.tipoProceso.findUnique({ where: { id: req.params.id } });
    if (!actual || !esVisible(actual, req.empresaId ?? null)) {
      throw new HttpError(404, "Tipo de proceso no encontrado");
    }
    autorizarEscritura(req, actual.empresaId);
    const { areaSlugs, ...data } = req.body;
    const areaIds = await resolverAreas(areaSlugs);

    const tipo = await prisma.$transaction(async (tx) => {
      await tx.tipoProcesoArea.deleteMany({ where: { tipoProcesoId: actual.id } });
      return tx.tipoProceso.update({
        where: { id: actual.id },
        data: {
          nombre: data.nombre,
          descripcion: data.descripcion,
          jurisdiccion: data.jurisdiccion,
          esquemaFormulario: data.esquemaFormulario,
          etapas: data.etapas,
          esquemaVersion: { increment: 1 },
          areas: { create: areaIds.map((areaId) => ({ areaId })) },
        },
        include: tipoInclude,
      });
    });
    res.json(serializeTipo(tipo));
  }),
);

/** DELETE /catalogo/tipos-proceso/:id — elimina un tipo (si no está en uso). */
catalogRoutes.delete(
  "/tipos-proceso/:id",
  requireAuth,
  validate({ params: tipoIdParams }),
  asyncHandler(async (req, res) => {
    const actual = await prisma.tipoProceso.findUnique({ where: { id: req.params.id } });
    if (!actual || !esVisible(actual, req.empresaId ?? null)) {
      throw new HttpError(404, "Tipo de proceso no encontrado");
    }
    autorizarEscritura(req, actual.empresaId);
    try {
      await prisma.tipoProceso.delete({ where: { id: actual.id } });
      res.status(204).end();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2003" || err.code === "P2014")
      ) {
        throw new HttpError(409, "No se puede eliminar: hay procesos de este tipo");
      }
      throw err;
    }
  }),
);

// --- Helpers ---

function esVisible(tipo: { empresaId: string | null }, empresaId: string | null): boolean {
  return tipo.empresaId === null || tipo.empresaId === empresaId;
}

/** Determina si la creación es global (ADMIN) o del despacho (esAdminEmpresa). */
function destinoCatalogo(req: import("express").Request): {
  empresaId: string | null;
  empresaKey: string;
} {
  if (req.user?.rol === Rol.ADMIN) return { empresaId: null, empresaKey: "" };
  if (req.empresaId && req.esAdminEmpresa) {
    return { empresaId: req.empresaId, empresaKey: req.empresaId };
  }
  throw new HttpError(403, "No autorizado para crear tipos de proceso");
}

/** Autoriza editar/eliminar: ADMIN sobre globales, esAdminEmpresa sobre los suyos. */
function autorizarEscritura(req: import("express").Request, empresaIdDelTipo: string | null): void {
  if (empresaIdDelTipo === null) {
    if (req.user?.rol !== Rol.ADMIN) throw new HttpError(403, "Solo ADMIN edita tipos globales");
    return;
  }
  if (!(req.esAdminEmpresa && empresaIdDelTipo === empresaIdRequerido(req))) {
    throw new HttpError(403, "No autorizado");
  }
}

async function resolverAreas(slugs: string[]): Promise<string[]> {
  const unicos = [...new Set(slugs)];
  const areas = await prisma.areaPractica.findMany({ where: { slug: { in: unicos } } });
  if (areas.length !== unicos.length) {
    throw new HttpError(400, "Una o más áreas de práctica no existen");
  }
  return areas.map((a) => a.id);
}
