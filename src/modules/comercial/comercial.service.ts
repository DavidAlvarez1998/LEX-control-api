// Casos de uso del módulo Comercial (embudo, tenant-scoped). Seguimientos/agenda,
// fases, cotización, contrato+cobro, alertas, pipeline, hoy, el PUENTE comercial→legal
// (solicitud → materializa Proceso+ParteProceso) y comisiones. Sin Express.
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { convertirCliente, findOrCreateLitiganteByDoc } from "../clientes/clientes.service";
import { type EtapaDef, etapaEntrada } from "../procesos/esquema";
import { generarCodigoInterno } from "../procesos/procesos.service";
import { conSaldoBatch } from "../contable/cartera.service";
import { ComercialRepository } from "./comercial.repository";
import type {
  agendaQuery, asignarSolicitudSchema, cancelarSeguimientoSchema, completarSeguimientoSchema,
  configCobroSchema, createComisionSchema, createContratoSchema, createCotizacionSchema,
  createSeguimientoSchema, createSolicitudSchema, moverFaseSchema, rechazarSolicitudSchema,
  updateComisionSchema, updateContratoSchema, updateCotizacionSchema, updateSeguimientoSchema,
} from "./comercial.schemas";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const DIA_MS = 24 * 60 * 60 * 1000;
const repo = (t: TenantContext) => new ComercialRepository(empresaIdOrThrow(t));
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

async function assertCliente(r: ComercialRepository, clienteId: string) {
  if (!(await r.clienteExists(clienteId))) throw new HttpError(400, "El cliente no pertenece a tu empresa");
}
async function assertTipoProceso(r: ComercialRepository, tipoProcesoId: string, empresaId: string) {
  const t = await r.findTipoProceso(tipoProcesoId);
  if (!t || (t.empresaId !== null && t.empresaId !== empresaId)) {
    throw new HttpError(400, "El tipo de proceso no es válido para tu empresa");
  }
}

// ===================== SEGUIMIENTOS =====================
export function listSeguimientos(t: TenantContext, clienteId?: string) {
  return repo(t).listSeguimientos(clienteId);
}
export async function createSeguimiento(t: TenantContext, body: In<typeof createSeguimientoSchema>) {
  const r = repo(t);
  if (body.clienteId) await assertCliente(r, body.clienteId);
  const comercialId = t.esAdminEmpresa && body.comercialId ? body.comercialId : t.userId;
  return r.createSeguimiento({ ...body, comercialId, empresaId: empresaIdOrThrow(t), registradoPorId: t.userId });
}
export async function updateSeguimiento(t: TenantContext, id: string, body: In<typeof updateSeguimientoSchema>) {
  const r = repo(t);
  const data = { ...body };
  if (!t.esAdminEmpresa) delete (data as { comercialId?: unknown }).comercialId; // solo admin reasigna dueño
  if ((await r.updateSeguimiento(id, data)) === 0) throw new HttpError(404, "Seguimiento no encontrado");
  return r.findSeguimiento(id);
}
async function transicionSeguimiento(t: TenantContext, id: string, data: Record<string, unknown>) {
  const r = repo(t);
  if ((await r.updateSeguimiento(id, data)) === 0) throw new HttpError(404, "Seguimiento no encontrado");
  return r.findSeguimiento(id);
}
export function completarSeguimiento(t: TenantContext, id: string, body: In<typeof completarSeguimientoSchema>) {
  return transicionSeguimiento(t, id, { completada: true, fechaCompletada: body.fechaCompletada ?? new Date(), ...(body.resultado ? { resultado: body.resultado } : {}) });
}
export function cancelarSeguimiento(t: TenantContext, id: string, body: In<typeof cancelarSeguimientoSchema>) {
  return transicionSeguimiento(t, id, { canceladaEn: new Date(), motivoCancelacion: body.motivo, completada: false, fechaCompletada: null });
}
export function reabrirSeguimiento(t: TenantContext, id: string) {
  return transicionSeguimiento(t, id, { completada: false, fechaCompletada: null, canceladaEn: null, motivoCancelacion: null });
}

// ===================== AGENDA =====================
export async function agenda(t: TenantContext, q: In<typeof agendaQuery>) {
  const r = repo(t);
  const hoy = new Date();
  const desde = startOfDay(q.desde ?? hoy);
  const hasta = endOfDay(q.hasta ?? q.desde ?? hoy);
  const comercialId = t.esAdminEmpresa ? q.comercialId : t.userId;

  const items = await r.agendaPendientes({ comercialId, incluirCompletadas: q.incluirCompletadas, desde, hasta });
  const verVencidas = desde >= startOfDay(hoy);
  const vencidas = verVencidas ? await r.agendaVencidas({ comercialId, desde }) : [];

  const registradores = [...new Set([...items, ...vencidas].map((s) => s.registradoPorId).filter((x): x is string => !!x))];
  const usuarios = registradores.length ? await r.usuariosByIds(registradores) : [];
  const creadorPorId = new Map(usuarios.map((u) => [u.id, { nombre: u.nombre, esAdminEmpresa: u.esAdminEmpresa, roles: u.rolesEmpresa.map((x) => x.rolEmpresa) }]));
  const conCreador = <T extends { registradoPorId: string | null }>(s: T) => ({ ...s, registradoPor: s.registradoPorId ? creadorPorId.get(s.registradoPorId) ?? null : null });

  return { desde, hasta, items: items.map(conCreador), vencidas: vencidas.map(conCreador) };
}

// ===================== FASES =====================
export async function listFases(t: TenantContext, clienteId: string) {
  const r = repo(t);
  await assertCliente(r, clienteId);
  return r.listFases(clienteId);
}
export async function moverFase(t: TenantContext, clienteId: string, body: In<typeof moverFaseSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const cliente = await r.findCliente(clienteId);
  if (!cliente) throw new HttpError(404, "Cliente no encontrado");
  const { fase, motivoPerdida } = body;
  if (fase === "PERDIDO" && !motivoPerdida) throw new HttpError(400, "El motivo de pérdida es obligatorio al marcar PERDIDO");

  return prisma.$transaction(async (tx) => {
    const rt = new ComercialRepository(empresaId, tx);
    await rt.cerrarFasesAbiertas(cliente.id);
    const row = await rt.createFase({
      empresaId, clienteId: cliente.id, fase,
      motivoPerdida: fase === "PERDIDO" ? motivoPerdida : null,
      responsableComercialId: cliente.responsableComercialId, registradoPorId: t.userId,
    });
    if (fase === "FIRMADO") await convertirCliente(tx, cliente);
    else if (fase === "PERDIDO") await rt.updateClienteEstado(cliente.id, "DESCARTADO");
    return row;
  });
}

// ===================== COTIZACIÓN =====================
export function listCotizaciones(t: TenantContext, clienteId?: string) {
  return repo(t).listCotizaciones(clienteId);
}
export async function createCotizacion(t: TenantContext, body: In<typeof createCotizacionSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  await assertCliente(r, body.clienteId);
  if (body.tipoProcesoId) await assertTipoProceso(r, body.tipoProcesoId, empresaId);
  return r.createCotizacion({ ...body, empresaId, creadoPorId: t.userId });
}
export async function updateCotizacion(t: TenantContext, id: string, body: In<typeof updateCotizacionSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  if (body.tipoProcesoId) await assertTipoProceso(r, body.tipoProcesoId, empresaId);
  if ((await r.updateCotizacion(id, body)) === 0) throw new HttpError(404, "Cotización no encontrada");
  return r.findCotizacion(id);
}

// ===================== CONTRATO + COBRO =====================
export function listContratos(t: TenantContext, clienteId?: string) {
  return repo(t).listContratos(clienteId);
}
export async function createContrato(t: TenantContext, body: In<typeof createContratoSchema>) {
  const r = repo(t);
  await assertCliente(r, body.clienteId);
  if (body.cotizacionId && !(await r.cotizacionExists(body.cotizacionId))) {
    throw new HttpError(400, "La cotización no pertenece a tu empresa");
  }
  return r.createContrato({ ...body, empresaId: empresaIdOrThrow(t), registradoPorId: t.userId });
}
export async function updateContrato(t: TenantContext, id: string, body: In<typeof updateContratoSchema>) {
  const r = repo(t);
  if ((await r.updateContrato(id, body)) === 0) throw new HttpError(404, "Contrato no encontrado");
  return r.findContrato(id);
}
export async function getCobro(t: TenantContext, contratoId: string) {
  const r = repo(t);
  if (!(await r.findContratoSelectId(contratoId))) throw new HttpError(404, "Contrato no encontrado");
  return r.findConfigCobro(contratoId);
}
export async function setCobro(t: TenantContext, contratoId: string, body: In<typeof configCobroSchema>) {
  const r = repo(t);
  const contrato = await r.findContratoConCliente(contratoId);
  if (!contrato) throw new HttpError(404, "Contrato no encontrado");
  return r.upsertConfigCobro(contrato.id, contrato.clienteId, body);
}

// ===================== ALERTAS =====================
export async function alertas(t: TenantContext) {
  const ahora = new Date();
  const hace3d = new Date(ahora.getTime() - 3 * DIA_MS);
  const inicioHoy = new Date(ahora); inicioHoy.setHours(0, 0, 0, 0);
  const finHoy = new Date(inicioHoy.getTime() + DIA_MS);
  const [sinSeg, propuestas, sinFirmar, poderes, cuotaVencida, citasHoy, tareasVencidas] = await repo(t).alertas(ahora, hace3d, inicioHoy, finHoy);
  return {
    prospectoSinSeguimiento: sinSeg.map((c) => ({ id: c.id, clienteId: c.id, nombre: c.nombre, telefono: c.telefono })),
    propuestaSinRespuesta: propuestas.map((x) => ({ id: x.id, clienteId: x.clienteId, nombre: x.cliente?.nombre ?? null, valorCotizado: x.valorCotizado })),
    contratoSinFirmar: sinFirmar.map((x) => ({ id: x.id, clienteId: x.clienteId, nombre: x.cliente?.nombre ?? null })),
    poderPendiente: poderes.map((x) => ({ id: x.id, clienteId: x.clienteId, nombre: x.cliente?.nombre ?? null })),
    cuotaInicialVencida: cuotaVencida.map((x) => ({ id: x.id, clienteId: x.clienteId, contratoId: x.contratoId, fechaPrimerPago: x.fechaPrimerPago })),
    citaHoy: citasHoy.map((x) => ({ id: x.id, clienteId: x.clienteId, nombre: x.cliente?.nombre ?? null, telefono: x.cliente?.telefono ?? null, fechaProximaTarea: x.fechaProximaTarea })),
    tareaVencida: tareasVencidas.map((x) => ({ id: x.id, clienteId: x.clienteId, nombre: x.cliente?.nombre ?? null, telefono: x.cliente?.telefono ?? null, proximaTarea: x.proximaTarea, fechaProximaTarea: x.fechaProximaTarea })),
  };
}

// ===================== PIPELINE =====================
export async function pipeline(t: TenantContext, mios: boolean) {
  const ahora = new Date();
  const dias = (desde: Date) => Math.floor((ahora.getTime() - desde.getTime()) / DIA_MS);
  const clientes = await repo(t).pipelineClientes(mios, t.userId);
  return clientes.map((c) => {
    const ultima = c.seguimientos[0];
    const conDisp = c.seguimientos.find((s) => s.disposicion);
    const prox = c.seguimientos.filter((s) => !s.completada && !s.canceladaEn && s.fechaProximaTarea).sort((a, b) => a.fechaProximaTarea!.getTime() - b.fechaProximaTarea!.getTime())[0];
    const fase = c.fasesComerciales[0];
    return {
      id: c.id, nombre: c.nombre, telefono: c.telefono, estado: c.estado, viabilidad: c.viabilidad, canalIngreso: c.canalIngreso,
      faseActual: fase?.fase ?? null, diasEnFase: fase ? dias(fase.fechaInicioFase) : null,
      ultimaGestionEn: ultima?.fechaContacto ?? null, diasSinGestion: ultima ? dias(ultima.fechaContacto) : null,
      ultimaDisposicion: conDisp?.disposicion ?? null,
      proximaTareaEn: prox?.fechaProximaTarea ?? null, proximaTarea: prox?.proximaTarea ?? null,
      tareaVencida: prox?.fechaProximaTarea ? prox.fechaProximaTarea < ahora : false,
    };
  });
}

// ===================== HOY =====================
export async function hoy(t: TenantContext, mios: boolean) {
  const ahora = new Date();
  const hace3d = new Date(ahora.getTime() - 3 * DIA_MS);
  const inicioHoy = new Date(ahora); inicioHoy.setHours(0, 0, 0, 0);
  const finHoy = new Date(inicioHoy.getTime() + DIA_MS);
  const r = repo(t);
  const [pendientes, frios] = await Promise.all([r.hoyPendientes(mios, t.userId, finHoy), r.hoyFrios(mios, t.userId, hace3d, ahora)]);
  const mapTarea = (s: (typeof pendientes)[number]) => ({
    id: s.id, clienteId: s.clienteId, nombre: s.cliente?.nombre ?? s.titulo ?? null,
    telefono: s.cliente?.telefono ?? null, tipoGestion: s.tipoGestion, tarea: s.proximaTarea ?? s.titulo ?? null, fechaProximaTarea: s.fechaProximaTarea,
  });
  return {
    vencidas: pendientes.filter((s) => s.fechaProximaTarea! < inicioHoy).map(mapTarea),
    hoy: pendientes.filter((s) => s.fechaProximaTarea! >= inicioHoy).map(mapTarea),
    frios: frios.map((c) => ({ id: null, clienteId: c.id, nombre: c.nombre, telefono: c.telefono, tipoGestion: null, tarea: null, fechaProximaTarea: null })),
  };
}

// ===================== SOLICITUDES (puente comercial→legal) =====================
export async function createSolicitud(t: TenantContext, body: In<typeof createSolicitudSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const { clienteId, contratoId, tipoProcesoId, ...rest } = body;

  const cliente = await r.findClienteParaSolicitud(clienteId);
  if (!cliente) throw new HttpError(400, "El cliente no pertenece a tu empresa");
  const contrato = await r.findContratoParaSolicitud(contratoId, clienteId);
  if (!contrato) throw new HttpError(400, "El contrato no pertenece a tu empresa/cliente");
  if (contrato.estadoContrato !== "FIRMADO" || contrato.estadoPoder !== "FIRMADO") {
    throw new HttpError(400, "El contrato y el poder deben estar firmados");
  }

  const config = await r.findConfigCobro(contratoId);
  const cobroSnapshot = {
    tipoCobroAcordado: contrato.tipoCobroAcordado,
    valorAcordado: contrato.valorAcordado?.toString() ?? null,
    porcentajeAcordado: contrato.porcentajeAcordado?.toString() ?? null,
    tieneConfigDetallada: !!config,
  };
  try {
    return await r.createSolicitud({
      empresaId, clienteId, contratoId,
      tipoProcesoId: tipoProcesoId ?? cliente.necesidadTipoProcesoId,
      resumenCaso: cliente.resumenCaso,
      cobroSnapshot: cobroSnapshot as Prisma.InputJsonValue,
      solicitadoPorId: t.userId,
      ...rest,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe una solicitud para este contrato");
    }
    throw err;
  }
}

export function listSolicitudes(t: TenantContext, estado?: string) {
  return repo(t).listSolicitudes(estado);
}

export async function asignarSolicitud(t: TenantContext, id: string, body: In<typeof asignarSolicitudSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const { abogadoAsignadoId, tipoProcesoId: override, tareasDefinidas } = body;

  const solicitud = await r.findSolicitud(id);
  if (!solicitud) throw new HttpError(404, "Solicitud no encontrada");
  if (solicitud.estado !== "PENDIENTE" && solicitud.estado !== "EN_REVISION") throw new HttpError(409, "La solicitud ya fue resuelta");

  if (!(await r.findAbogadoJuridico(abogadoAsignadoId))) {
    throw new HttpError(400, "El abogado asignado debe tener el rol JURIDICO en tu empresa");
  }
  const tipoProcesoId = override ?? solicitud.tipoProcesoId;
  if (!tipoProcesoId) throw new HttpError(400, "Debes indicar un tipo de proceso");
  const tipo = await r.findTipoProcesoFull(tipoProcesoId);
  if (!tipo || (tipo.empresaId !== null && tipo.empresaId !== empresaId)) throw new HttpError(400, "El tipo de proceso no es válido para tu empresa");
  const entrada = etapaEntrada(tipo.etapas as unknown as EtapaDef[]);
  if (!entrada) throw new HttpError(400, "El tipo de proceso no define etapas");
  const cliente = await r.findClienteOrThrow(solicitud.clienteId);

  return prisma.$transaction(async (tx) => {
    const rt = new ComercialRepository(empresaId, tx);
    const litiganteId = await findOrCreateLitiganteByDoc(tx, cliente);
    if (!cliente.litiganteId) await rt.updateClienteLitigante(cliente.id, litiganteId);
    const codigoInterno = await generarCodigoInterno(tx, empresaId, "COM");
    const proceso = await rt.createProceso({
      empresaId,
      tipoProcesoId: tipo.id,
      tipoEsquemaVersion: tipo.esquemaVersion,
      jurisdiccion: tipo.jurisdiccion, // del tipo, NO de la sugerida
      codigoInterno,
      titulo: solicitud.tituloPropuesto ?? cliente.nombre,
      estado: "ABIERTO",
      prioridad: solicitud.prioridad ?? "MEDIA",
      responsableId: abogadoAsignadoId,
      creadoPorId: t.userId,
      datos: {} as Prisma.InputJsonValue, // ningún campo del embudo mapea al esquema dinámico
      etapaActual: entrada.key,
      historial: { create: { etapaKey: entrada.key, usuarioId: t.userId } },
    });
    await rt.createParte({ procesoId: proceso.id, litiganteId, rol: solicitud.rolParteSugerido ?? "DEMANDANTE", esNuestroCliente: true });
    const upd = await rt.updateSolicitud(solicitud.id, {
      estado: "ASIGNADA", procesoId: proceso.id, abogadoAsignadoId, asignadoPorId: t.userId,
      tareasDefinidas: tareasDefinidas ?? solicitud.tareasDefinidas, fechaAsignacion: new Date(),
    });
    return { solicitud: upd, proceso };
  });
}

export async function rechazarSolicitud(t: TenantContext, id: string, body: In<typeof rechazarSolicitudSchema>) {
  const r = repo(t);
  if ((await r.rechazarSolicitud(id, body.motivoRechazo)) === 0) throw new HttpError(409, "La solicitud no existe o ya fue resuelta");
  return r.findSolicitud(id);
}

// ===================== CARTERA RESUMEN =====================
export async function carteraCliente(t: TenantContext, clienteId: string) {
  const r = repo(t);
  await assertCliente(r, clienteId);
  const filas = await r.listCarteraCliente(clienteId);
  return conSaldoBatch(filas);
}

// ===================== COMISIONES =====================
export function listComisiones(t: TenantContext, f: { clienteId?: string; comercialId?: string; estado?: string }) {
  const dueño = t.esAdminEmpresa ? (f.comercialId ? { comercialId: f.comercialId } : {}) : { comercialId: t.userId };
  return repo(t).listComisiones(dueño, f.clienteId, f.estado);
}
export async function createComision(t: TenantContext, body: In<typeof createComisionSchema>) {
  const r = repo(t);
  await assertCliente(r, body.clienteId);
  if (!(await r.usuarioExists(body.comercialId))) throw new HttpError(400, "El comercial no pertenece a tu empresa");
  return r.createComision({ ...body, empresaId: empresaIdOrThrow(t), registradoPorId: t.userId });
}
export async function updateComision(t: TenantContext, id: string, body: In<typeof updateComisionSchema>) {
  const r = repo(t);
  if ((await r.updateComision(id, body)) === 0) throw new HttpError(404, "Comisión no encontrada");
  return r.findComision(id);
}
