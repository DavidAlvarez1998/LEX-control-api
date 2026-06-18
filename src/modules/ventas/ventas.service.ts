// Casos de uso de Ventas (CRM de plataforma: prospectos + comisiones). Datos sin
// tenancy por empresa; el alcance es por COMERCIAL (un COMERCIAL solo ve lo suyo,
// el ADMIN ve todo). Sin Express; recibe TenantContext (rol + userId).
import { Prisma, Rol } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import type { TenantContext } from "../../shared/tenant";
import { VentasRepository } from "./ventas.repository";
import type {
  cancelarSeguimientoSchema, comisionPatchSchema, completarSeguimientoSchema, createProspectoSchema,
  createSeguimientoSchema, ganarSchema, perderSchema, updateProspectoSchema, updateSeguimientoSchema,
} from "./ventas.schemas";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const n = (d: Prisma.Decimal | null | undefined) => Number(d ?? 0);
const repo = () => new VentasRepository();
const esComercial = (t: TenantContext) => t.rol === Rol.COMERCIAL;
const scope = (t: TenantContext) => (esComercial(t) ? { comercialId: t.userId } : {});
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

async function planVigente(r: VentasRepository, planId: string) {
  const plan = await r.findPlan(planId);
  if (!plan) throw new HttpError(400, "El plan no existe");
  return plan;
}
async function assertComercial(r: VentasRepository, comercialId: string) {
  if (!(await r.findComercial(comercialId))) throw new HttpError(400, "El comercial no existe o no tiene rol COMERCIAL");
}
async function cargarProspecto(t: TenantContext, r: VentasRepository, id: string) {
  const p = await r.findProspectoScoped(id, scope(t));
  if (!p) throw new HttpError(404, "Prospecto no encontrado");
  return p;
}
async function cargarSeguimiento(t: TenantContext, r: VentasRepository, id: string) {
  const s = await r.findSeguimiento(id);
  if (!s) throw new HttpError(404, "Seguimiento no encontrado");
  if (!(await r.prospectoEnScope(s.prospectoId, scope(t)))) throw new HttpError(404, "Seguimiento no encontrado");
  return s;
}

// ===================== PROSPECTOS =====================
export function listProspectos(t: TenantContext, f: { estado?: string; canal?: string; comercialId?: string }) {
  return repo().listProspectos({
    ...scope(t),
    ...(f.estado ? { estado: f.estado as never } : {}),
    ...(f.canal ? { canalEntrada: f.canal as never } : {}),
    ...(!esComercial(t) && f.comercialId ? { comercialId: f.comercialId } : {}),
  });
}
export async function createProspecto(t: TenantContext, b: In<typeof createProspectoSchema>) {
  const r = repo();
  const comercialId = esComercial(t) ? t.userId : b.comercialId;
  if (comercialId && !esComercial(t)) await assertComercial(r, comercialId);
  if (b.planInteresId) await planVigente(r, b.planInteresId);
  return r.createProspecto({
    nombreEmpresa: b.nombreEmpresa, nombreContacto: b.nombreContacto,
    email: b.email, telefono: b.telefono, numeroDocumento: b.numeroDocumento, cargo: b.cargo,
    canalEntrada: b.canalEntrada, referidoPor: b.referidoPor, planInteresId: b.planInteresId,
    comercialId, notas: b.notas,
  });
}
export async function getProspecto(t: TenantContext, id: string) {
  const r = repo();
  const prospecto = await cargarProspecto(t, r, id);
  const comision = await r.comisionByProspecto(prospecto.id);
  return { ...prospecto, comision };
}
export async function updateProspecto(t: TenantContext, id: string, body: In<typeof updateProspectoSchema>) {
  const r = repo();
  const prospecto = await cargarProspecto(t, r, id);
  const b = { ...body };
  if (esComercial(t)) delete b.comercialId;
  else if (b.comercialId) await assertComercial(r, b.comercialId);
  if (b.planInteresId) await planVigente(r, b.planInteresId);
  const reasigna = !esComercial(t) && b.comercialId !== undefined && b.comercialId !== prospecto.comercialId;
  if (reasigna && prospecto.estado === "GANADO") throw new HttpError(409, "No se puede reasignar el comercial de un prospecto ya ganado");
  await r.updateProspectoScoped(id, scope(t), b);
  if (reasigna) await r.reassignPendingSeguimientos(id, b.comercialId ?? null);
  return r.findProspecto(id);
}
export async function ganarProspecto(t: TenantContext, id: string, body: In<typeof ganarSchema>) {
  const r = repo();
  const prospecto = await cargarProspecto(t, r, id);
  if (prospecto.estado === "GANADO") throw new HttpError(409, "El prospecto ya fue ganado");
  if (!prospecto.comercialId) throw new HttpError(400, "Asigna un comercial antes de cerrar la venta");
  const planId = body.planId ?? prospecto.planInteresId;
  if (!planId) throw new HttpError(400, "Indica el plan vendido");
  const plan = await planVigente(r, planId);

  const precioVenta = body.precioVenta ?? n(plan.precioMensual);
  const comercial = await r.findComercialPorcentaje(prospecto.comercialId);
  let porcentaje: number | null;
  let monto: number;
  if (body.montoComisionFijo != null) {
    porcentaje = null;
    monto = body.montoComisionFijo;
  } else {
    porcentaje = n(comercial?.porcentajeComision);
    monto = Math.round(precioVenta * porcentaje) / 100;
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = new VentasRepository(tx);
      const empresa = await rt.createEmpresa({ nombre: prospecto.nombreEmpresa, email: prospecto.email, telefono: prospecto.telefono });
      await rt.createSuscripcion({ empresaId: empresa.id, planId, estado: "ACTIVA" });
      const actualizado = await rt.updateProspecto(prospecto.id, { estado: "GANADO", planVendidoId: planId, precioVenta, fechaCierre: new Date(), empresaId: empresa.id });
      const comision = await rt.createComision({ prospectoId: prospecto.id, comercialId: prospecto.comercialId!, baseCalculo: precioVenta, porcentaje, monto, estado: "PENDIENTE" });
      return { prospecto: actualizado, empresaId: empresa.id, comision };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "El prospecto ya fue ganado");
    throw err;
  }
}
export async function perderProspecto(t: TenantContext, id: string, body: In<typeof perderSchema>) {
  const r = repo();
  const prospecto = await cargarProspecto(t, r, id);
  if (prospecto.estado === "GANADO") throw new HttpError(409, "El prospecto ya fue ganado");
  return r.updateProspecto(prospecto.id, { estado: "PERDIDO", motivoPerdida: body.motivoPerdida });
}

// ===================== SEGUIMIENTOS =====================
export async function listSeguimientos(t: TenantContext, prospectoId: string) {
  const r = repo();
  const prospecto = await cargarProspecto(t, r, prospectoId);
  return r.listSeguimientos(prospecto.id);
}
export async function createSeguimiento(t: TenantContext, prospectoId: string, b: In<typeof createSeguimientoSchema>) {
  const r = repo();
  const prospecto = await cargarProspecto(t, r, prospectoId);
  if (!esComercial(t) && b.comercialId) await assertComercial(r, b.comercialId);
  const comercialId = esComercial(t) ? t.userId : (b.comercialId ?? prospecto.comercialId ?? t.userId);
  if (!esComercial(t) && b.comercialId && !prospecto.comercialId) {
    await r.updateProspecto(prospecto.id, { comercialId: b.comercialId });
  }
  const programada = b.fechaProgramada != null;
  const creado = await r.createSeguimiento({
    prospectoId: prospecto.id, comercialId,
    tipo: b.tipo ?? "LLAMADA", titulo: b.titulo, nota: b.nota, resultado: b.resultado,
    fechaProgramada: b.fechaProgramada, completada: !programada, fechaCompletada: programada ? null : new Date(),
  });
  if (!programada) await r.avanzarAContactado(prospecto.id);
  return creado;
}
export async function updateSeguimiento(t: TenantContext, id: string, body: In<typeof updateSeguimientoSchema>) {
  const r = repo();
  await cargarSeguimiento(t, r, id);
  const b = { ...body };
  if (esComercial(t)) delete b.comercialId;
  return r.updateSeguimiento(id, b);
}
export async function completarSeguimiento(t: TenantContext, id: string, body: In<typeof completarSeguimientoSchema>) {
  const r = repo();
  const s = await cargarSeguimiento(t, r, id);
  const actualizado = await r.updateSeguimiento(id, { completada: true, fechaCompletada: body.fechaCompletada ?? new Date(), ...(body.resultado ? { resultado: body.resultado } : {}) });
  await r.avanzarAContactado(s.prospectoId);
  return actualizado;
}
export async function cancelarSeguimiento(t: TenantContext, id: string, body: In<typeof cancelarSeguimientoSchema>) {
  const r = repo();
  await cargarSeguimiento(t, r, id);
  return r.updateSeguimiento(id, { canceladaEn: new Date(), motivoCancelacion: body.motivo, completada: false, fechaCompletada: null });
}
export async function reabrirSeguimiento(t: TenantContext, id: string) {
  const r = repo();
  await cargarSeguimiento(t, r, id);
  return r.updateSeguimiento(id, { completada: false, fechaCompletada: null, canceladaEn: null, motivoCancelacion: null });
}
export async function deleteSeguimiento(t: TenantContext, id: string): Promise<void> {
  const r = repo();
  await cargarSeguimiento(t, r, id);
  await r.deleteSeguimiento(id);
}

// ===================== AGENDA =====================
export async function agenda(t: TenantContext, q: { desde?: Date; hasta?: Date; comercialId?: string; incluirCompletadas?: boolean }) {
  const r = repo();
  const hoy = new Date();
  const desde = startOfDay(q.desde ?? hoy);
  const hasta = endOfDay(q.hasta ?? q.desde ?? hoy);
  const comercialId = esComercial(t) ? t.userId : q.comercialId;
  const dueño = comercialId ? { comercialId } : {};
  const items = await r.agendaItems(dueño, !!q.incluirCompletadas, desde, hasta);
  const verVencidas = desde >= startOfDay(hoy);
  const vencidas = verVencidas ? await r.agendaVencidas(dueño, desde) : [];
  return { desde, hasta, items, vencidas };
}

// ===================== EQUIPO COMERCIAL =====================
export async function equipoComercial() {
  const r = repo();
  const comerciales = await r.listComerciales();
  const ids = comerciales.map((c) => c.id);
  const [porEstado, pendientes] = ids.length
    ? await Promise.all([r.prospectosGroupBy(ids), r.seguimientosPendientesGroupBy(ids)])
    : [[], []];

  const totales = new Map<string, { prospectos: number; ganados: number }>();
  for (const row of porEstado) {
    if (!row.comercialId) continue;
    const tt = totales.get(row.comercialId) ?? { prospectos: 0, ganados: 0 };
    tt.prospectos += row._count._all;
    if (row.estado === "GANADO") tt.ganados += row._count._all;
    totales.set(row.comercialId, tt);
  }
  const pend = new Map(pendientes.map((r2) => [r2.comercialId, r2._count._all]));
  return comerciales.map((c) => ({
    ...c,
    porcentajeComision: c.porcentajeComision == null ? null : n(c.porcentajeComision),
    prospectos: totales.get(c.id)?.prospectos ?? 0,
    ganados: totales.get(c.id)?.ganados ?? 0,
    pendientesAgenda: pend.get(c.id) ?? 0,
  }));
}

// ===================== COMISIONES =====================
export function listComisiones(t: TenantContext, f: { estado?: string; comercialId?: string }) {
  return repo().listComisiones({
    ...scope(t),
    ...(f.estado ? { estado: f.estado as never } : {}),
    ...(!esComercial(t) && f.comercialId ? { comercialId: f.comercialId } : {}),
  });
}
export async function updateComision(id: string, b: In<typeof comisionPatchSchema>) {
  const r = repo();
  if (!(await r.findComisionId(id))) throw new HttpError(404, "Comisión no encontrada");
  const data: Prisma.ComisionUpdateInput = {};
  if (b.estado !== undefined) data.estado = b.estado;
  if (b.monto !== undefined) data.monto = b.monto;
  if (b.porcentaje !== undefined) data.porcentaje = b.porcentaje;
  if (b.notas !== undefined) data.notas = b.notas;
  if (b.fechaPago !== undefined) data.fechaPago = b.fechaPago;
  else if (b.estado === "PAGADA") data.fechaPago = new Date();
  else if (b.estado) data.fechaPago = null; // sale de PAGADA (aquí b.estado ya no es "PAGADA")
  return r.updateComision(id, data as Record<string, unknown>);
}
