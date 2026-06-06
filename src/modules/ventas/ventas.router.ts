// Venta de la PLATAFORMA: prospectos (embudo) + comisiones. CRM propio de LEX
// Control vendiendo Planes a despachos. Datos a nivel plataforma (sin tenancy por
// empresa); se acotan por el COMERCIAL asignado. Gating con requireRole (no el
// sistema de permisos de empresa). Ver openspec/changes/admin-comercial-ventas/.
import { Router, type Request } from "express";
import { Prisma, Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  comisionPatchSchema, createProspectoSchema, ganarSchema, idParams,
  perderSchema, updateProspectoSchema,
} from "./ventas.schemas";

export const prospectoRoutes: Router = Router();
export const comisionRoutes: Router = Router();

const n = (d: Prisma.Decimal | null | undefined) => Number(d ?? 0);
const esComercial = (req: Request) => req.user!.rol === Rol.COMERCIAL;
/** Filtro base: un COMERCIAL solo ve lo suyo; el ADMIN ve todo. */
const scope = (req: Request) => (esComercial(req) ? { comercialId: req.user!.sub } : {});

async function planVigente(planId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, precioMensual: true } });
  if (!plan) throw new HttpError(400, "El plan no existe");
  return plan;
}
async function assertComercial(comercialId: string) {
  const u = await prisma.usuario.findFirst({ where: { id: comercialId, rol: Rol.COMERCIAL }, select: { id: true } });
  if (!u) throw new HttpError(400, "El comercial no existe o no tiene rol COMERCIAL");
}

// ===================== PROSPECTOS =====================
prospectoRoutes.get("/", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  asyncHandler(async (req, res) => {
    const { estado, canal, comercialId } = req.query as Record<string, string | undefined>;
    res.json(await prisma.prospecto.findMany({
      where: {
        ...scope(req),
        ...(estado ? { estado: estado as never } : {}),
        ...(canal ? { canalEntrada: canal as never } : {}),
        ...(!esComercial(req) && comercialId ? { comercialId } : {}),
      },
      orderBy: { createdAt: "desc" },
    }));
  }));

prospectoRoutes.post("/", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ body: createProspectoSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    // El COMERCIAL solo puede crear prospectos para sí mismo.
    const comercialId = esComercial(req) ? req.user!.sub : b.comercialId;
    if (comercialId && !esComercial(req)) await assertComercial(comercialId);
    if (b.planInteresId) await planVigente(b.planInteresId);
    res.status(201).json(await prisma.prospecto.create({
      data: {
        nombreEmpresa: b.nombreEmpresa, nombreContacto: b.nombreContacto,
        email: b.email, telefono: b.telefono, cargo: b.cargo,
        canalEntrada: b.canalEntrada, planInteresId: b.planInteresId,
        comercialId, notas: b.notas,
      },
    }));
  }));

/** Carga un prospecto respetando el alcance del rol (404 si no es suyo). */
async function cargarProspecto(req: Request) {
  const p = await prisma.prospecto.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!p) throw new HttpError(404, "Prospecto no encontrado");
  return p;
}

prospectoRoutes.get("/:id", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const prospecto = await cargarProspecto(req);
    const comision = await prisma.comision.findUnique({ where: { prospectoId: prospecto.id } });
    res.json({ ...prospecto, comision });
  }));

prospectoRoutes.patch("/:id", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: updateProspectoSchema }),
  asyncHandler(async (req, res) => {
    await cargarProspecto(req);
    const b = { ...req.body };
    // Solo ADMIN reasigna; el COMERCIAL no puede mover comercialId.
    if (esComercial(req)) delete b.comercialId;
    else if (b.comercialId) await assertComercial(b.comercialId);
    if (b.planInteresId) await planVigente(b.planInteresId);
    await prisma.prospecto.updateMany({ where: { id: req.params.id, ...scope(req) }, data: b });
    res.json(await prisma.prospecto.findUnique({ where: { id: req.params.id } }));
  }));

/** Ganar: crea Empresa + Suscripcion + Comision en una transacción. */
prospectoRoutes.post("/:id/ganar", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: ganarSchema }),
  asyncHandler(async (req, res) => {
    const prospecto = await cargarProspecto(req);
    if (prospecto.estado === "GANADO") throw new HttpError(409, "El prospecto ya fue ganado");
    if (!prospecto.comercialId) throw new HttpError(400, "Asigna un comercial antes de cerrar la venta");

    const planId = req.body.planId ?? prospecto.planInteresId;
    if (!planId) throw new HttpError(400, "Indica el plan vendido");
    const plan = await planVigente(planId);

    const precioVenta = req.body.precioVenta ?? n(plan.precioMensual);
    const comercial = await prisma.usuario.findUnique({
      where: { id: prospecto.comercialId }, select: { porcentajeComision: true },
    });
    let porcentaje: number | null;
    let monto: number;
    if (req.body.montoComisionFijo != null) {
      porcentaje = null;
      monto = req.body.montoComisionFijo;
    } else {
      porcentaje = n(comercial?.porcentajeComision);
      monto = Math.round(precioVenta * porcentaje) / 100;
    }

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const empresa = await tx.empresa.create({
          data: { nombre: prospecto.nombreEmpresa, email: prospecto.email, telefono: prospecto.telefono },
        });
        await tx.suscripcion.create({ data: { empresaId: empresa.id, planId, estado: "ACTIVA" } });
        const actualizado = await tx.prospecto.update({
          where: { id: prospecto.id },
          data: {
            estado: "GANADO", planVendidoId: planId, precioVenta,
            fechaCierre: new Date(), empresaId: empresa.id,
          },
        });
        const comision = await tx.comision.create({
          data: {
            prospectoId: prospecto.id, comercialId: prospecto.comercialId!,
            baseCalculo: precioVenta, porcentaje, monto, estado: "PENDIENTE",
          },
        });
        return { prospecto: actualizado, empresaId: empresa.id, comision };
      });
      res.status(201).json(resultado);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new HttpError(409, "El prospecto ya fue ganado");
      throw err;
    }
  }));

prospectoRoutes.post("/:id/perder", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: perderSchema }),
  asyncHandler(async (req, res) => {
    const prospecto = await cargarProspecto(req);
    if (prospecto.estado === "GANADO") throw new HttpError(409, "El prospecto ya fue ganado");
    res.json(await prisma.prospecto.update({
      where: { id: prospecto.id }, data: { estado: "PERDIDO", motivoPerdida: req.body.motivoPerdida },
    }));
  }));

// ===================== COMISIONES =====================
comisionRoutes.get("/", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  asyncHandler(async (req, res) => {
    const { estado, comercialId } = req.query as Record<string, string | undefined>;
    res.json(await prisma.comision.findMany({
      where: {
        ...scope(req),
        ...(estado ? { estado: estado as never } : {}),
        ...(!esComercial(req) && comercialId ? { comercialId } : {}),
      },
      orderBy: { createdAt: "desc" },
    }));
  }));

/** Solo ADMIN liquida (PAGADA) o anula una comisión. */
comisionRoutes.patch("/:id", requireAuth, requireRole(Rol.ADMIN),
  validate({ params: idParams, body: comisionPatchSchema }),
  asyncHandler(async (req, res) => {
    const existe = await prisma.comision.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) throw new HttpError(404, "Comisión no encontrada");
    const data: Prisma.ComisionUpdateInput = { estado: req.body.estado, notas: req.body.notas };
    if (req.body.estado === "PAGADA") data.fechaPago = req.body.fechaPago ?? new Date();
    res.json(await prisma.comision.update({ where: { id: req.params.id }, data }));
  }));
