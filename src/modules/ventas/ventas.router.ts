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
  agendaQuery, cancelarSeguimientoSchema, comisionPatchSchema, completarSeguimientoSchema,
  createProspectoSchema, createSeguimientoSchema, ganarSchema, idParams, perderSchema,
  updateProspectoSchema, updateSeguimientoSchema,
} from "./ventas.schemas";

export const prospectoRoutes: Router = Router();
export const comisionRoutes: Router = Router();
export const seguimientoRoutes: Router = Router();
export const agendaRoutes: Router = Router();
export const equipoComercialRoutes: Router = Router();

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
        email: b.email, telefono: b.telefono, numeroDocumento: b.numeroDocumento, cargo: b.cargo,
        canalEntrada: b.canalEntrada, referidoPor: b.referidoPor, planInteresId: b.planInteresId,
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
    const prospecto = await cargarProspecto(req);
    const b = { ...req.body };
    // Solo ADMIN reasigna; el COMERCIAL no puede mover comercialId.
    if (esComercial(req)) delete b.comercialId;
    else if (b.comercialId) await assertComercial(b.comercialId);
    if (b.planInteresId) await planVigente(b.planInteresId);
    // ¿El ADMIN está reasignando el prospecto a otro comercial?
    const reasigna = !esComercial(req) && b.comercialId !== undefined && b.comercialId !== prospecto.comercialId;
    // No se puede reasignar un prospecto ya GANADO: la Comisión ya se generó apuntando
    // al comercial de cierre y quedaría inconsistente con el dueño del prospecto.
    if (reasigna && prospecto.estado === "GANADO")
      throw new HttpError(409, "No se puede reasignar el comercial de un prospecto ya ganado");
    await prisma.prospecto.updateMany({ where: { id: req.params.id, ...scope(req) }, data: b });
    // Al reasignar, las actividades PENDIENTES pasan al nuevo dueño (para que aparezcan
    // en su agenda); las completadas/canceladas quedan con quien las hizo (historial).
    if (reasigna) {
      await prisma.seguimientoProspecto.updateMany({
        where: { prospectoId: req.params.id, completada: false, canceladaEn: null },
        data: { comercialId: b.comercialId ?? null },
      });
    }
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

// ===================== SEGUIMIENTO (timeline por prospecto) =====================
// Resumen del prospecto que acompaña cada item de la agenda.
const PROSPECTO_RESUMEN = { id: true, nombreEmpresa: true, nombreContacto: true, estado: true, telefono: true } as const;

prospectoRoutes.get("/:id/seguimientos", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const prospecto = await cargarProspecto(req); // 404 si no es suyo
    res.json(await prisma.seguimientoProspecto.findMany({
      where: { prospectoId: prospecto.id },
      orderBy: { createdAt: "desc" },
    }));
  }));

prospectoRoutes.post("/:id/seguimientos", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: createSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    const prospecto = await cargarProspecto(req);
    const b = req.body;
    // Dueño (agenda): el COMERCIAL solo a sí mismo; ADMIN puede fijarlo, default = dueño del prospecto.
    if (!esComercial(req) && b.comercialId) await assertComercial(b.comercialId);
    const comercialId = esComercial(req)
      ? req.user!.sub
      : (b.comercialId ?? prospecto.comercialId ?? req.user!.sub);
    // Si el ADMIN asigna un comercial y el prospecto no tenía dueño, se lo asigna también.
    if (!esComercial(req) && b.comercialId && !prospecto.comercialId) {
      await prisma.prospecto.update({ where: { id: prospecto.id }, data: { comercialId: b.comercialId } });
    }
    // Sin fechaProgramada => se registra como ya hecha (timeline). Con fecha => pendiente (agenda).
    const programada = b.fechaProgramada != null;
    const creado = await prisma.seguimientoProspecto.create({
      data: {
        prospectoId: prospecto.id, comercialId,
        tipo: b.tipo ?? "LLAMADA", titulo: b.titulo, nota: b.nota, resultado: b.resultado,
        fechaProgramada: b.fechaProgramada,
        completada: !programada,
        fechaCompletada: programada ? null : new Date(),
      },
    });
    // Registrar una actividad ya hecha implica contacto -> NUEVO pasa a CONTACTADO.
    if (!programada) await avanzarAContactado(prospecto.id);
    res.status(201).json(creado);
  }));

// Carga un seguimiento verificando que su prospecto esté en el alcance del rol.
async function cargarSeguimiento(req: Request) {
  const s = await prisma.seguimientoProspecto.findUnique({ where: { id: req.params.id } });
  if (!s) throw new HttpError(404, "Seguimiento no encontrado");
  const p = await prisma.prospecto.findFirst({ where: { id: s.prospectoId, ...scope(req) }, select: { id: true } });
  if (!p) throw new HttpError(404, "Seguimiento no encontrado");
  return s;
}

seguimientoRoutes.patch("/:id", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: updateSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    await cargarSeguimiento(req);
    const b = { ...req.body };
    if (esComercial(req)) delete b.comercialId; // el COMERCIAL no reasigna dueño
    res.json(await prisma.seguimientoProspecto.update({ where: { id: req.params.id }, data: b }));
  }));

// Completar una actividad implica que ya hubo contacto: si el prospecto sigue en
// NUEVO, avanza a CONTACTADO (idempotente; no toca estados posteriores ni terminales).
async function avanzarAContactado(prospectoId: string) {
  await prisma.prospecto.updateMany({ where: { id: prospectoId, estado: "NUEVO" }, data: { estado: "CONTACTADO" } });
}

seguimientoRoutes.post("/:id/completar", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: completarSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    const s = await cargarSeguimiento(req);
    const actualizado = await prisma.seguimientoProspecto.update({
      where: { id: req.params.id },
      data: {
        completada: true,
        fechaCompletada: req.body.fechaCompletada ?? new Date(),
        ...(req.body.resultado ? { resultado: req.body.resultado } : {}),
      },
    });
    await avanzarAContactado(s.prospectoId);
    res.json(actualizado);
  }));

seguimientoRoutes.post("/:id/cancelar", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams, body: cancelarSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    await cargarSeguimiento(req);
    res.json(await prisma.seguimientoProspecto.update({
      where: { id: req.params.id },
      data: { canceladaEn: new Date(), motivoCancelacion: req.body.motivo, completada: false, fechaCompletada: null },
    }));
  }));

// Reabrir: vuelve una actividad completada/cancelada (por error) a pendiente.
seguimientoRoutes.post("/:id/reabrir", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await cargarSeguimiento(req);
    res.json(await prisma.seguimientoProspecto.update({
      where: { id: req.params.id },
      data: { completada: false, fechaCompletada: null, canceladaEn: null, motivoCancelacion: null },
    }));
  }));

seguimientoRoutes.delete("/:id", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await cargarSeguimiento(req);
    await prisma.seguimientoProspecto.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));

// ===================== AGENDA (pendientes por comercial) =====================
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

agendaRoutes.get("/", requireAuth, requireRole(Rol.ADMIN, Rol.COMERCIAL),
  validate({ query: agendaQuery }),
  asyncHandler(async (req, res) => {
    // validate() solo valida la query; re-parseamos para obtener las fechas ya coercionadas.
    const q = agendaQuery.parse(req.query);
    const hoy = new Date();
    const desde = startOfDay(q.desde ?? hoy);
    const hasta = endOfDay(q.hasta ?? q.desde ?? hoy);
    // Dueño: el COMERCIAL siempre el suyo; el ADMIN puede filtrar por uno.
    const comercialId = esComercial(req) ? req.user!.sub : q.comercialId;
    const dueño = comercialId ? { comercialId } : {};

    const enrich = { prospecto: { select: PROSPECTO_RESUMEN } };

    // Pendiente = ni completada ni cancelada. El calendario pide incluirCompletadas
    // para mostrar también completadas/canceladas en gris (no se borran).
    const pendiente = { completada: false, canceladaEn: null };
    const items = await prisma.seguimientoProspecto.findMany({
      where: { ...dueño, ...(q.incluirCompletadas ? {} : pendiente), fechaProgramada: { gte: desde, lte: hasta } },
      orderBy: { fechaProgramada: "asc" },
      include: enrich,
    });

    // Vencidas: pendientes con fecha anterior al inicio del rango (solo si el rango arranca hoy o después).
    const verVencidas = desde >= startOfDay(hoy);
    const vencidas = verVencidas
      ? await prisma.seguimientoProspecto.findMany({
          where: { ...dueño, ...pendiente, fechaProgramada: { lt: desde, not: null } },
          orderBy: { fechaProgramada: "asc" },
          include: enrich,
        })
      : [];

    res.json({ desde, hasta, items, vencidas });
  }));

// ===================== EQUIPO COMERCIAL (vista ADMIN) =====================
// Resumen del equipo: cada comercial con sus contadores (prospectos, ganados,
// pendientes en agenda). Solo ADMIN — para supervisar al equipo de ventas.
equipoComercialRoutes.get("/", requireAuth, requireRole(Rol.ADMIN),
  asyncHandler(async (_req, res) => {
    const comerciales = await prisma.usuario.findMany({
      where: { rol: Rol.COMERCIAL },
      select: { id: true, nombre: true, email: true, activo: true, porcentajeComision: true },
      orderBy: { nombre: "asc" },
    });
    const ids = comerciales.map((c) => c.id);
    const [porEstado, pendientes] = ids.length
      ? await Promise.all([
          prisma.prospecto.groupBy({ by: ["comercialId", "estado"], where: { comercialId: { in: ids } }, _count: { _all: true } }),
          // Pendiente = ni completada ni cancelada (misma definición que la agenda).
          prisma.seguimientoProspecto.groupBy({ by: ["comercialId"], where: { comercialId: { in: ids }, completada: false, canceladaEn: null }, _count: { _all: true } }),
        ])
      : [[], []];

    const totales = new Map<string, { prospectos: number; ganados: number }>();
    for (const row of porEstado) {
      if (!row.comercialId) continue;
      const t = totales.get(row.comercialId) ?? { prospectos: 0, ganados: 0 };
      t.prospectos += row._count._all;
      if (row.estado === "GANADO") t.ganados += row._count._all;
      totales.set(row.comercialId, t);
    }
    const pend = new Map(pendientes.map((r) => [r.comercialId, r._count._all]));

    res.json(comerciales.map((c) => ({
      ...c,
      porcentajeComision: c.porcentajeComision == null ? null : n(c.porcentajeComision),
      prospectos: totales.get(c.id)?.prospectos ?? 0,
      ganados: totales.get(c.id)?.ganados ?? 0,
      pendientesAgenda: pend.get(c.id) ?? 0,
    })));
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
    const b = req.body;
    const data: Prisma.ComisionUpdateInput = {};
    if (b.estado !== undefined) data.estado = b.estado;
    if (b.monto !== undefined) data.monto = b.monto;
    if (b.porcentaje !== undefined) data.porcentaje = b.porcentaje; // nullable (null = monto fijo)
    if (b.notas !== undefined) data.notas = b.notas;
    // Fecha de pago: explícita > automática al marcar PAGADA > se limpia si sale de PAGADA.
    if (b.fechaPago !== undefined) data.fechaPago = b.fechaPago;
    else if (b.estado === "PAGADA") data.fechaPago = new Date();
    else if (b.estado && b.estado !== "PAGADA") data.fechaPago = null;
    res.json(await prisma.comision.update({ where: { id: req.params.id }, data }));
  }));
