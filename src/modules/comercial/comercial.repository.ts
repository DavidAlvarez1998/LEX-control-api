// Acceso a datos del módulo Comercial (embudo). Tenant-scoped (empresaId forzado al
// construir). Acepta client opcional para las transacciones del servicio (mover fase,
// asignar solicitud → materializa Proceso + ParteProceso).
import type { Prisma } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

const CLIENTE_RESUMEN = { id: true, nombre: true, telefono: true } as const;
const enrichCliente = { cliente: { select: CLIENTE_RESUMEN } };

export class ComercialRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}
  private get e() {
    return this.empresaId;
  }

  // --- asserts ---
  clienteExists(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  findTipoProceso(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id }, select: { empresaId: true } });
  }
  usuarioExists(id: string) {
    return this.db.usuario.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }

  // --- seguimientos ---
  listSeguimientos(clienteId?: string) {
    return this.db.seguimientoComercial.findMany({
      where: { empresaId: this.e, ...(clienteId ? { clienteId } : {}) },
      orderBy: { fechaContacto: "desc" },
    });
  }
  createSeguimiento(data: Record<string, unknown>) {
    return this.db.seguimientoComercial.create({ data: data as never });
  }
  async updateSeguimiento(id: string, data: Record<string, unknown>) {
    return (await this.db.seguimientoComercial.updateMany({ where: { id, empresaId: this.e }, data: data as never })).count;
  }
  findSeguimiento(id: string) {
    return this.db.seguimientoComercial.findUnique({ where: { id } });
  }

  // --- agenda ---
  agendaPendientes(opts: { comercialId?: string; incluirCompletadas?: boolean; desde: Date; hasta: Date }) {
    const pendiente = { completada: false, canceladaEn: null };
    return this.db.seguimientoComercial.findMany({
      where: {
        empresaId: this.e,
        ...(opts.comercialId ? { comercialId: opts.comercialId } : {}),
        ...(opts.incluirCompletadas ? {} : pendiente),
        fechaProximaTarea: { gte: opts.desde, lte: opts.hasta },
      },
      orderBy: { fechaProximaTarea: "asc" },
      include: enrichCliente,
    });
  }
  agendaVencidas(opts: { comercialId?: string; desde: Date }) {
    return this.db.seguimientoComercial.findMany({
      where: {
        empresaId: this.e,
        ...(opts.comercialId ? { comercialId: opts.comercialId } : {}),
        completada: false, canceladaEn: null,
        fechaProximaTarea: { lt: opts.desde, not: null },
      },
      orderBy: { fechaProximaTarea: "asc" },
      include: enrichCliente,
    });
  }
  usuariosByIds(ids: string[]) {
    return this.db.usuario.findMany({
      where: { id: { in: ids }, empresaId: this.e },
      select: { id: true, nombre: true, esAdminEmpresa: true, rolesEmpresa: { select: { rolEmpresa: true } } },
    });
  }

  // --- fases ---
  listFases(clienteId: string) {
    return this.db.faseComercialHistorial.findMany({ where: { clienteId }, orderBy: { fechaInicioFase: "desc" } });
  }
  findCliente(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.e } });
  }
  cerrarFasesAbiertas(clienteId: string) {
    return this.db.faseComercialHistorial.updateMany({ where: { clienteId, fechaCierreFase: null }, data: { fechaCierreFase: new Date() } });
  }
  createFase(data: Record<string, unknown>) {
    return this.db.faseComercialHistorial.create({ data: data as never });
  }
  updateClienteEstado(id: string, estado: string) {
    return this.db.cliente.update({ where: { id }, data: { estado: estado as never } });
  }

  // --- cotización ---
  listCotizaciones(clienteId?: string) {
    return this.db.cotizacion.findMany({ where: { empresaId: this.e, ...(clienteId ? { clienteId } : {}) }, orderBy: { createdAt: "desc" } });
  }
  createCotizacion(data: Record<string, unknown>) {
    return this.db.cotizacion.create({ data: data as never });
  }
  async updateCotizacion(id: string, data: Record<string, unknown>) {
    return (await this.db.cotizacion.updateMany({ where: { id, empresaId: this.e }, data: data as never })).count;
  }
  findCotizacion(id: string) {
    return this.db.cotizacion.findUnique({ where: { id } });
  }
  cotizacionExists(id: string) {
    return this.db.cotizacion.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }

  // --- contrato + cobro ---
  listContratos(clienteId?: string) {
    return this.db.contratoComercial.findMany({ where: { empresaId: this.e, ...(clienteId ? { clienteId } : {}) }, orderBy: { createdAt: "desc" } });
  }
  createContrato(data: Record<string, unknown>) {
    return this.db.contratoComercial.create({ data: data as never });
  }
  async updateContrato(id: string, data: Record<string, unknown>) {
    return (await this.db.contratoComercial.updateMany({ where: { id, empresaId: this.e }, data: data as never })).count;
  }
  findContrato(id: string) {
    return this.db.contratoComercial.findUnique({ where: { id } });
  }
  findContratoSelectId(id: string) {
    return this.db.contratoComercial.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  findContratoConCliente(id: string) {
    return this.db.contratoComercial.findFirst({ where: { id, empresaId: this.e }, select: { id: true, clienteId: true } });
  }
  findConfigCobro(contratoId: string) {
    return this.db.configuracionCobro.findUnique({ where: { contratoId } });
  }
  upsertConfigCobro(contratoId: string, clienteId: string, data: Record<string, unknown>) {
    return this.db.configuracionCobro.upsert({
      where: { contratoId },
      update: data as never,
      create: { ...data, contratoId, clienteId, empresaId: this.e } as never,
    });
  }

  // --- pipeline ---
  pipelineClientes(mios: boolean, userId: string) {
    return this.db.cliente.findMany({
      where: { empresaId: this.e, estado: { in: ["PROSPECTO", "CLIENTE"] }, ...(mios ? { responsableComercialId: userId } : {}) },
      select: {
        id: true, nombre: true, telefono: true, estado: true, viabilidad: true, canalIngreso: true, responsableComercialId: true,
        seguimientos: { orderBy: { fechaContacto: "desc" }, take: 50, select: { fechaContacto: true, disposicion: true, completada: true, canceladaEn: true, fechaProximaTarea: true, proximaTarea: true } },
        fasesComerciales: { where: { fechaCierreFase: null }, orderBy: { fechaInicioFase: "desc" }, take: 1, select: { fase: true, fechaInicioFase: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  // --- hoy ---
  hoyPendientes(mios: boolean, userId: string, finHoy: Date) {
    return this.db.seguimientoComercial.findMany({
      where: { empresaId: this.e, ...(mios ? { comercialId: userId } : {}), completada: false, canceladaEn: null, fechaProximaTarea: { not: null, lt: finHoy } },
      orderBy: { fechaProximaTarea: "asc" },
      select: { id: true, clienteId: true, titulo: true, tipoGestion: true, proximaTarea: true, fechaProximaTarea: true, cliente: { select: { nombre: true, telefono: true } } },
    });
  }
  hoyFrios(mios: boolean, userId: string, hace3d: Date, ahora: Date) {
    return this.db.cliente.findMany({
      where: {
        empresaId: this.e, estado: "PROSPECTO", ...(mios ? { responsableComercialId: userId } : {}),
        AND: [
          { seguimientos: { none: { fechaContacto: { gte: hace3d } } } },
          { seguimientos: { none: { completada: false, canceladaEn: null, fechaProximaTarea: { gte: ahora } } } },
        ],
      },
      select: { id: true, nombre: true, telefono: true },
      orderBy: { fechaIngreso: "asc" },
    });
  }

  // --- alertas (7 queries derivadas) ---
  alertas(ahora: Date, hace3d: Date, inicioHoy: Date, finHoy: Date) {
    const e = this.e;
    return Promise.all([
      this.db.cliente.findMany({ where: { empresaId: e, estado: "PROSPECTO", seguimientos: { none: { fechaContacto: { gte: hace3d } } } }, select: { id: true, nombre: true, telefono: true } }),
      this.db.cotizacion.findMany({ where: { empresaId: e, estadoPropuesta: { in: ["ENVIADA", "PENDIENTE"] }, fechaEnvio: { lt: hace3d } }, select: { id: true, clienteId: true, valorCotizado: true, cliente: { select: { nombre: true } } } }),
      this.db.contratoComercial.findMany({ where: { empresaId: e, estadoContrato: "ENVIADO", fechaEnvio: { lt: hace3d } }, select: { id: true, clienteId: true, cliente: { select: { nombre: true } } } }),
      this.db.contratoComercial.findMany({ where: { empresaId: e, estadoPoder: "PENDIENTE" }, select: { id: true, clienteId: true, cliente: { select: { nombre: true } } } }),
      this.db.configuracionCobro.findMany({ where: { empresaId: e, fechaPrimerPago: { lt: ahora } }, select: { id: true, contratoId: true, clienteId: true, fechaPrimerPago: true } }),
      this.db.seguimientoComercial.findMany({ where: { empresaId: e, tipoGestion: { in: ["REUNION", "VIDEOLLAMADA"] }, fechaProximaTarea: { gte: inicioHoy, lt: finHoy } }, select: { id: true, clienteId: true, fechaProximaTarea: true, cliente: { select: { nombre: true, telefono: true } } } }),
      this.db.seguimientoComercial.findMany({ where: { empresaId: e, estadoSeguimiento: { not: "CERRADO" }, fechaProximaTarea: { lt: ahora } }, select: { id: true, clienteId: true, proximaTarea: true, fechaProximaTarea: true, cliente: { select: { nombre: true, telefono: true } } } }),
    ]);
  }

  // --- solicitudes (puente comercial→legal) ---
  findClienteParaSolicitud(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.e }, select: { id: true, necesidadTipoProcesoId: true, resumenCaso: true } });
  }
  findContratoParaSolicitud(id: string, clienteId: string) {
    return this.db.contratoComercial.findFirst({
      where: { id, empresaId: this.e, clienteId },
      select: { id: true, estadoContrato: true, estadoPoder: true, tipoCobroAcordado: true, valorAcordado: true, porcentajeAcordado: true },
    });
  }
  createSolicitud(data: Record<string, unknown>) {
    return this.db.solicitudAsignacionProceso.create({ data: data as never });
  }
  listSolicitudes(estado?: string) {
    return this.db.solicitudAsignacionProceso.findMany({ where: { empresaId: this.e, ...(estado ? { estado: estado as never } : {}) }, orderBy: { fechaSolicitud: "desc" } });
  }
  findSolicitud(id: string) {
    return this.db.solicitudAsignacionProceso.findFirst({ where: { id, empresaId: this.e } });
  }
  findAbogadoJuridico(usuarioId: string) {
    return this.db.usuarioRolEmpresa.findFirst({ where: { usuarioId, empresaId: this.e, rolEmpresa: "JURIDICO" }, select: { id: true } });
  }
  findTipoProcesoFull(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id } });
  }
  findClienteOrThrow(id: string) {
    return this.db.cliente.findUniqueOrThrow({ where: { id } });
  }
  updateClienteLitigante(id: string, litiganteId: string) {
    return this.db.cliente.update({ where: { id }, data: { litiganteId } });
  }
  createProceso(data: Record<string, unknown>) {
    return this.db.proceso.create({ data: data as never });
  }
  createParte(data: Record<string, unknown>) {
    return this.db.parteProceso.create({ data: data as never });
  }
  updateSolicitud(id: string, data: Record<string, unknown>) {
    return this.db.solicitudAsignacionProceso.update({ where: { id }, data: data as never });
  }
  async rechazarSolicitud(id: string, motivoRechazo: string) {
    return (await this.db.solicitudAsignacionProceso.updateMany({
      where: { id, empresaId: this.e, estado: { in: ["PENDIENTE", "EN_REVISION"] } },
      data: { estado: "RECHAZADA", motivoRechazo },
    })).count;
  }

  // --- cartera resumen ---
  listCarteraCliente(clienteId: string) {
    return this.db.cartera.findMany({ where: { empresaId: this.e, clienteId }, orderBy: { createdAt: "desc" } });
  }

  // --- comisiones ---
  listComisiones(dueño: { comercialId?: string }, clienteId?: string, estado?: string) {
    return this.db.comisionDespacho.findMany({
      where: { empresaId: this.e, ...dueño, ...(clienteId ? { clienteId } : {}), ...(estado ? { estado: estado as never } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }
  createComision(data: Record<string, unknown>) {
    return this.db.comisionDespacho.create({ data: data as never });
  }
  async updateComision(id: string, data: Record<string, unknown>) {
    return (await this.db.comisionDespacho.updateMany({ where: { id, empresaId: this.e }, data: data as never })).count;
  }
  findComision(id: string) {
    return this.db.comisionDespacho.findUnique({ where: { id } });
  }
}
