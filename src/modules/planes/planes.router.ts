// Administración de PLANES (portal ADMIN de plataforma). Catálogo de planes
// (precio + módulos + cupos por rol) y asignación de un plan a cada despacho.
// Solo ADMIN. Ver el Canva del producto / openspec foundations (planes-entitlements).
import { Router } from "express";
import { Prisma, Rol, RolEmpresa } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  asignarPlanSchema, createPlanSchema, planIdParams, updatePlanSchema,
} from "./planes.schemas";

export const planRoutes: Router = Router();
const n = (d: Prisma.Decimal) => Number(d);

const shape = (p: {
  id: string; clave: string; nombre: string; precioMensual: Prisma.Decimal; activo: boolean; orden: number;
  modulos: { modulo: { clave: string } }[]; cuotas: { rolEmpresa: RolEmpresa; limite: number | null }[];
}) => ({
  id: p.id, clave: p.clave, nombre: p.nombre, precioMensual: n(p.precioMensual), activo: p.activo, orden: p.orden,
  modulos: p.modulos.map((m) => m.modulo.clave),
  cuotas: Object.fromEntries(p.cuotas.map((c) => [c.rolEmpresa, c.limite])),
});
const incl = { modulos: { include: { modulo: { select: { clave: true } } } }, cuotas: true } as const;

/** GET /planes/modulos — catálogo de módulos (para el editor). */
planRoutes.get(
  "/modulos",
  requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.modulo.findMany({
      orderBy: { orden: "asc" },
      select: { id: true, clave: true, nombre: true, esBaseline: true },
    }));
  }),
);

/** GET /planes/suscripciones — despachos con su plan actual. */
planRoutes.get(
  "/suscripciones",
  requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    const empresas = await prisma.empresa.findMany({
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, activo: true, suscripcion: { select: { estado: true, plan: { select: { clave: true, nombre: true } } } } },
    });
    res.json(empresas.map((e) => ({
      id: e.id, nombre: e.nombre, activo: e.activo,
      plan: e.suscripcion?.plan.nombre ?? null, planClave: e.suscripcion?.plan.clave ?? null,
      estado: e.suscripcion?.estado ?? null,
    })));
  }),
);

/** PUT /planes/suscripciones/:empresaId — asigna/cambia el plan de un despacho. */
planRoutes.put(
  "/suscripciones/:empresaId",
  requireAuth, requireRole(Rol.ADMIN),
  validate({ body: asignarPlanSchema }),
  asyncHandler(async (req, res) => {
    const { empresaId } = req.params;
    const plan = await prisma.plan.findUnique({ where: { id: req.body.planId }, select: { id: true } });
    if (!plan) throw new HttpError(400, "El plan no existe");
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } });
    if (!empresa) throw new HttpError(404, "Empresa no encontrada");
    await prisma.suscripcion.upsert({
      where: { empresaId },
      update: { planId: plan.id, estado: "ACTIVA" },
      create: { empresaId, planId: plan.id, estado: "ACTIVA" },
    });
    res.json({ ok: true });
  }),
);

/** GET /planes — catálogo de planes con sus módulos y cupos. */
planRoutes.get(
  "/",
  requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    const planes = await prisma.plan.findMany({ orderBy: { orden: "asc" }, include: incl });
    res.json(planes.map(shape));
  }),
);

/** Resuelve claves de módulos NO-baseline a ids (ignora baseline / inexistentes). */
async function moduloIds(claves: string[]): Promise<string[]> {
  const mods = await prisma.modulo.findMany({ where: { clave: { in: claves }, esBaseline: false }, select: { id: true } });
  return mods.map((m) => m.id);
}

/** POST /planes — crea un plan. */
planRoutes.post(
  "/",
  requireAuth, requireRole(Rol.ADMIN),
  validate({ body: createPlanSchema }),
  asyncHandler(async (req, res) => {
    const { clave, nombre, precioMensual, orden, activo, modulos, cuotas } = req.body;
    const mods = await moduloIds(modulos);
    try {
      const plan = await prisma.$transaction(async (tx) => {
        const p = await tx.plan.create({ data: { clave, nombre, precioMensual, orden: orden ?? 0, activo: activo ?? true } });
        for (const moduloId of mods) await tx.planModulo.create({ data: { planId: p.id, moduloId } });
        for (const [rol, limite] of Object.entries(cuotas) as [RolEmpresa, number | null | undefined][]) {
          if (limite !== undefined) await tx.planCuota.create({ data: { planId: p.id, rolEmpresa: rol, limite } });
        }
        return tx.plan.findUniqueOrThrow({ where: { id: p.id }, include: incl });
      });
      res.status(201).json(shape(plan));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new HttpError(409, "Ya existe un plan con esa clave");
      throw err;
    }
  }),
);

/** PATCH /planes/:id — edita un plan (módulos/cupos: si vienen, reemplazan el set). */
planRoutes.patch(
  "/:id",
  requireAuth, requireRole(Rol.ADMIN),
  validate({ params: planIdParams, body: updatePlanSchema }),
  asyncHandler(async (req, res) => {
    const { modulos, cuotas, ...campos } = req.body;
    const id = req.params.id;
    try {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.plan.update({ where: { id }, data: campos });
        if (modulos !== undefined) {
          await tx.planModulo.deleteMany({ where: { planId: id } });
          for (const moduloId of await moduloIds(modulos)) await tx.planModulo.create({ data: { planId: id, moduloId } });
        }
        if (cuotas !== undefined) {
          await tx.planCuota.deleteMany({ where: { planId: id } });
          for (const [rol, limite] of Object.entries(cuotas) as [RolEmpresa, number | null | undefined][]) {
            if (limite !== undefined) await tx.planCuota.create({ data: { planId: id, rolEmpresa: rol, limite } });
          }
        }
        return tx.plan.findUniqueOrThrow({ where: { id }, include: incl });
      });
      res.json(shape(plan));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
        throw new HttpError(404, "Plan no encontrado");
      throw err;
    }
  }),
);
