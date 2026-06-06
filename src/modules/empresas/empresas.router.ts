import { Router } from "express";
import { Prisma, Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  createEmpresaSchema,
  empresaIdParams,
  updateEmpresaSchema,
  type ServicioAsignadoInput,
} from "./empresas.schemas";

export const empresaRoutes: Router = Router();

/** Empresa con sus servicios asignados (cada uno con el servicio del catálogo). */
const empresaConServicios = {
  servicios: { include: { servicio: true } },
} as const;

/**
 * Valida los `servicioId` contra el catálogo y construye las filas de
 * `EmpresaServicio` rellenando los precios omitidos con los valores de
 * referencia del catálogo. Lanza 400 si algún servicio no existe.
 */
async function resolverAsignaciones(
  empresaId: string,
  servicios: ServicioAsignadoInput[],
) {
  const ids = servicios.map((s) => s.servicioId);
  const catalogo = await prisma.servicio.findMany({
    where: { id: { in: ids } },
  });
  const porId = new Map(catalogo.map((s) => [s.id, s]));

  return servicios.map((s) => {
    const ref = porId.get(s.servicioId);
    if (!ref) {
      throw new HttpError(400, `El servicio ${s.servicioId} no existe`);
    }
    return {
      empresaId,
      servicioId: s.servicioId,
      precioBase: s.precioBase ?? ref.precioBase,
      precioPorUnidad: s.precioPorUnidad ?? ref.precioPorUnidad,
      incluidos: s.incluidos ?? ref.incluidos,
      activo: s.activo ?? true,
    };
  });
}

/** GET /empresas — lista todas las empresas, con conteo de usuarios y servicios. */
empresaRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    const empresas = await prisma.empresa.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { usuarios: true, servicios: true } },
        // Nombres de TODOS los servicios asignados, ordenados alfabéticamente.
        // La lista del admin los muestra bajo cada empresa.
        servicios: {
          orderBy: { servicio: { nombre: "asc" } },
          select: { servicio: { select: { nombre: true } } },
        },
      },
    });
    res.json(empresas);
  }),
);

/** GET /empresas/:id — una empresa con sus usuarios y servicios asignados. */
empresaRoutes.get(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams }),
  asyncHandler(async (req, res) => {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.params.id },
      include: {
        usuarios: true,
        servicios: { include: { servicio: true } },
      },
    });
    if (!empresa) throw new HttpError(404, "Empresa no encontrada");
    res.json(empresa);
  }),
);

/** POST /empresas — crea una empresa. */
empresaRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createEmpresaSchema }),
  asyncHandler(async (req, res) => {
    const { servicios, ...datos } = req.body;
    try {
      const filas = servicios
        ? await resolverAsignaciones("", servicios)
        : [];
      const empresa = await prisma.$transaction(async (tx) => {
        const creada = await tx.empresa.create({ data: datos });
        if (filas.length) {
          await tx.empresaServicio.createMany({
            data: filas.map((f) => ({ ...f, empresaId: creada.id })),
          });
        }
        return tx.empresa.findUnique({
          where: { id: creada.id },
          include: empresaConServicios,
        });
      });
      res.status(201).json(empresa);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new HttpError(409, "Ya existe una empresa con ese RFC/NIT");
      }
      throw err;
    }
  }),
);

/** PATCH /empresas/:id — actualiza una empresa. */
empresaRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams, body: updateEmpresaSchema }),
  asyncHandler(async (req, res) => {
    const { servicios, ...datos } = req.body;
    const empresaId = req.params.id;
    try {
      // Resuelve/valida las asignaciones antes de abrir la transacción.
      const filas =
        servicios !== undefined
          ? await resolverAsignaciones(empresaId, servicios)
          : null;

      const empresa = await prisma.$transaction(async (tx) => {
        await tx.empresa.update({ where: { id: empresaId }, data: datos });

        if (filas !== null) {
          // Replace-set: crea/actualiza las indicadas y elimina las omitidas.
          const idsDeseados = filas.map((f) => f.servicioId);
          await tx.empresaServicio.deleteMany({
            where: { empresaId, servicioId: { notIn: idsDeseados } },
          });
          for (const f of filas) {
            const { empresaId: _e, servicioId, ...precios } = f;
            await tx.empresaServicio.upsert({
              where: { empresaId_servicioId: { empresaId, servicioId } },
              create: f,
              update: precios,
            });
          }
        }

        return tx.empresa.findUnique({
          where: { id: empresaId },
          include: empresaConServicios,
        });
      });
      res.json(empresa);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") {
          throw new HttpError(404, "Empresa no encontrada");
        }
        if (err.code === "P2002") {
          throw new HttpError(409, "Ya existe una empresa con ese RFC/NIT");
        }
      }
      throw err;
    }
  }),
);

/** DELETE /empresas/:id — elimina una empresa (cascada a usuarios y asignaciones). */
empresaRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: empresaIdParams }),
  asyncHandler(async (req, res) => {
    try {
      await prisma.empresa.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new HttpError(404, "Empresa no encontrada");
      }
      throw err;
    }
  }),
);
