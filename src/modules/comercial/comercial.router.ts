// Módulo COMERCIAL (embudo de ventas) sobre el Cliente. Tenant-scoped igual que
// clientes.router (empresaId del token, hard WHERE, assertSameEmpresa) y gateado
// por requirePermiso con claves CONCRETAS. Ver openspec/changes/comercial-funnel/.
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth, requirePermiso } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import { convertirCliente, findOrCreateLitiganteByDoc } from "../clientes/clientes.service";
import { type EtapaDef, etapaEntrada } from "../procesos/esquema";
import { generarCodigoInterno } from "../procesos/procesos.service";
import {
  agendaQuery,
  asignarSolicitudSchema,
  cancelarSeguimientoSchema,
  completarSeguimientoSchema,
  configCobroSchema,
  createComisionSchema,
  createContratoSchema,
  createCotizacionSchema,
  createSeguimientoSchema,
  createSolicitudSchema,
  idParams,
  moverFaseSchema,
  rechazarSolicitudSchema,
  updateComisionSchema,
  updateContratoSchema,
  updateCotizacionSchema,
  updateSeguimientoSchema,
} from "./comercial.schemas";
import { conSaldo } from "../contable/cartera.service";

export const comercialRoutes: Router = Router();

const DIA_MS = 24 * 60 * 60 * 1000;

/** Verifica que un cliente pertenezca a la empresa del token (FK same-empresa). */
async function assertCliente(empresaId: string, clienteId: string): Promise<void> {
  const c = await prisma.cliente.findFirst({
    where: { id: clienteId, empresaId },
    select: { id: true },
  });
  if (!c) throw new HttpError(400, "El cliente no pertenece a tu empresa");
}

// ===================== SEGUIMIENTO =====================

comercialRoutes.get(
  "/seguimientos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const clienteId = typeof req.query.clienteId === "string" ? req.query.clienteId : undefined;
    const seguimientos = await prisma.seguimientoComercial.findMany({
      where: { empresaId, ...(clienteId ? { clienteId } : {}) },
      orderBy: { fechaContacto: "desc" },
    });
    res.json(seguimientos);
  }),
);

comercialRoutes.post(
  "/seguimientos",
  requireAuth,
  validate({ body: createSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    // Solo verificar pertenencia si se especifica un cliente
    if (req.body.clienteId) await assertCliente(empresaId, req.body.clienteId);
    // Dueño (agenda): por defecto el usuario actual; solo el admin de empresa puede fijar otro.
    const comercialId = req.esAdminEmpresa && req.body.comercialId ? req.body.comercialId : req.user!.sub;
    const seguimiento = await prisma.seguimientoComercial.create({
      data: { ...req.body, comercialId, empresaId, registradoPorId: req.user!.sub },
    });
    res.status(201).json(seguimiento);
  }),
);

comercialRoutes.patch(
  "/seguimientos/:id",
  requireAuth,
  validate({ params: idParams, body: updateSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const data = { ...req.body };
    if (!req.esAdminEmpresa) delete data.comercialId; // solo el admin reasigna dueño
    const { count } = await prisma.seguimientoComercial.updateMany({
      where: { id: req.params.id, empresaId },
      data,
    });
    if (count === 0) throw new HttpError(404, "Seguimiento no encontrado");
    res.json(await prisma.seguimientoComercial.findUnique({ where: { id: req.params.id } }));
  }),
);

// ===================== AGENDA (calendario del comercial) =====================
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

// Resumen del cliente para pintar el calendario (nombre + teléfono para WhatsApp).
const CLIENTE_RESUMEN = { id: true, nombre: true, telefono: true } as const;

comercialRoutes.get(
  "/agenda",
  requireAuth,
  validate({ query: agendaQuery }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const q = agendaQuery.parse(req.query);
    const hoy = new Date();
    const desde = startOfDay(q.desde ?? hoy);
    const hasta = endOfDay(q.hasta ?? q.desde ?? hoy);
    // Dueño: el comercial (no-admin) siempre el suyo; el admin de empresa puede filtrar por uno.
    const comercialId = req.esAdminEmpresa ? q.comercialId : req.user!.sub;
    const dueño = comercialId ? { comercialId } : {};
    const enrich = { cliente: { select: CLIENTE_RESUMEN } };
    const pendiente = { completada: false, canceladaEn: null };

    const items = await prisma.seguimientoComercial.findMany({
      where: { empresaId, ...dueño, ...(q.incluirCompletadas ? {} : pendiente), fechaProximaTarea: { gte: desde, lte: hasta } },
      orderBy: { fechaProximaTarea: "asc" },
      include: enrich,
    });

    // Vencidas: pendientes con fecha anterior al rango (solo si el rango arranca hoy o después).
    const verVencidas = desde >= startOfDay(hoy);
    const vencidas = verVencidas
      ? await prisma.seguimientoComercial.findMany({
          where: { empresaId, ...dueño, ...pendiente, fechaProximaTarea: { lt: desde, not: null } },
          orderBy: { fechaProximaTarea: "asc" },
          include: enrich,
        })
      : [];

    // Creador de cada ítem (nombre + roles) para la vista del admin de empresa.
    // registradoPorId es escalar (sin FK) → se resuelve en batch, scoped por empresa.
    const registradores = [
      ...new Set([...items, ...vencidas].map((s) => s.registradoPorId).filter((x): x is string => !!x)),
    ];
    const usuarios = registradores.length
      ? await prisma.usuario.findMany({
          where: { id: { in: registradores }, empresaId },
          select: { id: true, nombre: true, esAdminEmpresa: true, rolesEmpresa: { select: { rolEmpresa: true } } },
        })
      : [];
    const creadorPorId = new Map(
      usuarios.map((u) => [u.id, { nombre: u.nombre, esAdminEmpresa: u.esAdminEmpresa, roles: u.rolesEmpresa.map((r) => r.rolEmpresa) }]),
    );
    const conCreador = <T extends { registradoPorId: string | null }>(s: T) => ({
      ...s,
      registradoPor: s.registradoPorId ? creadorPorId.get(s.registradoPorId) ?? null : null,
    });

    res.json({ desde, hasta, items: items.map(conCreador), vencidas: vencidas.map(conCreador) });
  }),
);

comercialRoutes.post(
  "/seguimientos/:id/completar",
  requireAuth,
  validate({ params: idParams, body: completarSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.seguimientoComercial.updateMany({
      where: { id: req.params.id, empresaId },
      data: {
        completada: true,
        fechaCompletada: req.body.fechaCompletada ?? new Date(),
        ...(req.body.resultado ? { resultado: req.body.resultado } : {}),
      },
    });
    if (count === 0) throw new HttpError(404, "Seguimiento no encontrado");
    res.json(await prisma.seguimientoComercial.findUnique({ where: { id: req.params.id } }));
  }),
);

comercialRoutes.post(
  "/seguimientos/:id/cancelar",
  requireAuth,
  validate({ params: idParams, body: cancelarSeguimientoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.seguimientoComercial.updateMany({
      where: { id: req.params.id, empresaId },
      data: { canceladaEn: new Date(), motivoCancelacion: req.body.motivo, completada: false, fechaCompletada: null },
    });
    if (count === 0) throw new HttpError(404, "Seguimiento no encontrado");
    res.json(await prisma.seguimientoComercial.findUnique({ where: { id: req.params.id } }));
  }),
);

comercialRoutes.post(
  "/seguimientos/:id/reabrir",
  requireAuth,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.seguimientoComercial.updateMany({
      where: { id: req.params.id, empresaId },
      data: { completada: false, fechaCompletada: null, canceladaEn: null, motivoCancelacion: null },
    });
    if (count === 0) throw new HttpError(404, "Seguimiento no encontrado");
    res.json(await prisma.seguimientoComercial.findUnique({ where: { id: req.params.id } }));
  }),
);

// ===================== FASES =====================

comercialRoutes.get(
  "/clientes/:id/fases",
  requireAuth,
  requirePermiso("comercial.fase.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    await assertCliente(empresaId, req.params.id);
    const fases = await prisma.faseComercialHistorial.findMany({
      where: { clienteId: req.params.id },
      orderBy: { fechaInicioFase: "desc" },
    });
    res.json(fases);
  }),
);

comercialRoutes.post(
  "/clientes/:id/fase",
  requireAuth,
  requirePermiso("comercial.fase.mover"),
  validate({ params: idParams, body: moverFaseSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId },
    });
    if (!cliente) throw new HttpError(404, "Cliente no encontrado");
    const { fase, motivoPerdida } = req.body as { fase: string; motivoPerdida?: string };
    if (fase === "PERDIDO" && !motivoPerdida) {
      throw new HttpError(400, "El motivo de pérdida es obligatorio al marcar PERDIDO");
    }

    const nueva = await prisma.$transaction(async (tx) => {
      // Cerrar la fase actual abierta (si la hay — init lazy).
      await tx.faseComercialHistorial.updateMany({
        where: { clienteId: cliente.id, fechaCierreFase: null },
        data: { fechaCierreFase: new Date() },
      });
      const row = await tx.faseComercialHistorial.create({
        data: {
          empresaId,
          clienteId: cliente.id,
          fase: fase as never,
          motivoPerdida: fase === "PERDIDO" ? motivoPerdida : null,
          responsableComercialId: cliente.responsableComercialId,
          registradoPorId: req.user!.sub,
        },
      });
      // Acoplamiento de fases terminales con el estado del Cliente.
      if (fase === "FIRMADO") await convertirCliente(tx, cliente);
      else if (fase === "PERDIDO") {
        await tx.cliente.update({ where: { id: cliente.id }, data: { estado: "DESCARTADO" } });
      }
      return row;
    });
    res.status(201).json(nueva);
  }),
);

// ===================== COTIZACIÓN =====================

comercialRoutes.get(
  "/cotizaciones",
  requireAuth,
  requirePermiso("comercial.cotizacion.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const clienteId = typeof req.query.clienteId === "string" ? req.query.clienteId : undefined;
    res.json(
      await prisma.cotizacion.findMany({
        where: { empresaId, ...(clienteId ? { clienteId } : {}) },
        orderBy: { createdAt: "desc" },
      }),
    );
  }),
);

comercialRoutes.post(
  "/cotizaciones",
  requireAuth,
  requirePermiso("comercial.cotizacion.crear"),
  validate({ body: createCotizacionSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    await assertCliente(empresaId, req.body.clienteId);
    if (req.body.tipoProcesoId) await assertTipoProceso(empresaId, req.body.tipoProcesoId);
    const cotizacion = await prisma.cotizacion.create({
      data: { ...req.body, empresaId, creadoPorId: req.user!.sub },
    });
    res.status(201).json(cotizacion);
  }),
);

comercialRoutes.patch(
  "/cotizaciones/:id",
  requireAuth,
  requirePermiso("comercial.cotizacion.editar"),
  validate({ params: idParams, body: updateCotizacionSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    if (req.body.tipoProcesoId) await assertTipoProceso(empresaId, req.body.tipoProcesoId);
    const { count } = await prisma.cotizacion.updateMany({
      where: { id: req.params.id, empresaId },
      data: req.body,
    });
    if (count === 0) throw new HttpError(404, "Cotización no encontrada");
    res.json(await prisma.cotizacion.findUnique({ where: { id: req.params.id } }));
  }),
);

/** Un TipoProceso es válido si es global (empresaId null) o de la propia empresa. */
async function assertTipoProceso(empresaId: string, tipoProcesoId: string): Promise<void> {
  const t = await prisma.tipoProceso.findUnique({
    where: { id: tipoProcesoId },
    select: { empresaId: true },
  });
  if (!t || (t.empresaId !== null && t.empresaId !== empresaId)) {
    throw new HttpError(400, "El tipo de proceso no es válido para tu empresa");
  }
}

// ===================== CONTRATO + COBRO =====================

comercialRoutes.get(
  "/contratos",
  requireAuth,
  requirePermiso("comercial.contrato.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const clienteId = typeof req.query.clienteId === "string" ? req.query.clienteId : undefined;
    res.json(
      await prisma.contratoComercial.findMany({
        where: { empresaId, ...(clienteId ? { clienteId } : {}) },
        orderBy: { createdAt: "desc" },
      }),
    );
  }),
);

comercialRoutes.post(
  "/contratos",
  requireAuth,
  requirePermiso("comercial.contrato.crear"),
  validate({ body: createContratoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    await assertCliente(empresaId, req.body.clienteId);
    if (req.body.cotizacionId) {
      const c = await prisma.cotizacion.findFirst({
        where: { id: req.body.cotizacionId, empresaId },
        select: { id: true },
      });
      if (!c) throw new HttpError(400, "La cotización no pertenece a tu empresa");
    }
    const contrato = await prisma.contratoComercial.create({
      data: { ...req.body, empresaId, registradoPorId: req.user!.sub },
    });
    res.status(201).json(contrato);
  }),
);

comercialRoutes.patch(
  "/contratos/:id",
  requireAuth,
  requirePermiso("comercial.contrato.editar"),
  validate({ params: idParams, body: updateContratoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.contratoComercial.updateMany({
      where: { id: req.params.id, empresaId },
      data: req.body,
    });
    if (count === 0) throw new HttpError(404, "Contrato no encontrado");
    res.json(await prisma.contratoComercial.findUnique({ where: { id: req.params.id } }));
  }),
);

comercialRoutes.get(
  "/contratos/:id/cobro",
  requireAuth,
  requirePermiso("comercial.cobro.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const contrato = await prisma.contratoComercial.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true },
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    res.json(await prisma.configuracionCobro.findUnique({ where: { contratoId: req.params.id } }));
  }),
);

comercialRoutes.put(
  "/contratos/:id/cobro",
  requireAuth,
  requirePermiso("comercial.cobro.configurar"),
  validate({ params: idParams, body: configCobroSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const contrato = await prisma.contratoComercial.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true, clienteId: true },
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    const config = await prisma.configuracionCobro.upsert({
      where: { contratoId: contrato.id },
      update: req.body,
      create: { ...req.body, contratoId: contrato.id, clienteId: contrato.clienteId, empresaId },
    });
    res.json(config);
  }),
);

// ===================== ALERTAS (derivadas) =====================

comercialRoutes.get(
  "/alertas",
  requireAuth,
  requirePermiso("comercial.alertas.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const ahora = new Date();
    const hace3d = new Date(ahora.getTime() - 3 * DIA_MS);
    const inicioHoy = new Date(ahora);
    inicioHoy.setHours(0, 0, 0, 0);
    const finHoy = new Date(inicioHoy.getTime() + DIA_MS);

    const [
      prospectosSinSeguimiento,
      propuestasSinRespuesta,
      contratosSinFirmar,
      poderesPendientes,
      cuotaInicialVencida,
      citasHoy,
      tareasVencidas,
    ] = await Promise.all([
      prisma.cliente.findMany({
        where: { empresaId, estado: "PROSPECTO", seguimientos: { none: { fechaContacto: { gte: hace3d } } } },
        select: { id: true, nombre: true },
      }),
      prisma.cotizacion.findMany({
        where: { empresaId, estadoPropuesta: { in: ["ENVIADA", "PENDIENTE"] }, fechaEnvio: { lt: hace3d } },
        select: { id: true, clienteId: true, valorCotizado: true },
      }),
      prisma.contratoComercial.findMany({
        where: { empresaId, estadoContrato: "ENVIADO", fechaEnvio: { lt: hace3d } },
        select: { id: true, clienteId: true },
      }),
      prisma.contratoComercial.findMany({
        where: { empresaId, estadoPoder: "PENDIENTE" },
        select: { id: true, clienteId: true },
      }),
      prisma.configuracionCobro.findMany({
        where: { empresaId, fechaPrimerPago: { lt: ahora } },
        select: { id: true, contratoId: true, fechaPrimerPago: true },
      }),
      prisma.seguimientoComercial.findMany({
        where: {
          empresaId,
          tipoGestion: { in: ["REUNION", "VIDEOLLAMADA"] },
          fechaProximaTarea: { gte: inicioHoy, lt: finHoy },
        },
        select: { id: true, clienteId: true, fechaProximaTarea: true },
      }),
      prisma.seguimientoComercial.findMany({
        where: { empresaId, estadoSeguimiento: { not: "CERRADO" }, fechaProximaTarea: { lt: ahora } },
        select: { id: true, clienteId: true, proximaTarea: true, fechaProximaTarea: true },
      }),
    ]);

    res.json({
      prospectoSinSeguimiento: prospectosSinSeguimiento,
      propuestaSinRespuesta: propuestasSinRespuesta,
      contratoSinFirmar: contratosSinFirmar,
      poderPendiente: poderesPendientes,
      cuotaInicialVencida,
      citaHoy: citasHoy,
      tareaVencida: tareasVencidas,
    });
  }),
);

// ===================== SOLICITUD DE ASIGNACIÓN (el puente comercial→legal) =====================

/** POST /comercial/solicitudes — pide asignar un proceso para un contrato FIRMADO. */
comercialRoutes.post(
  "/solicitudes",
  requireAuth,
  requirePermiso("comercial.solicitud.crear"),
  validate({ body: createSolicitudSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { clienteId, contratoId, tipoProcesoId, ...rest } = req.body;

    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: { id: true, necesidadTipoProcesoId: true, resumenCaso: true },
    });
    if (!cliente) throw new HttpError(400, "El cliente no pertenece a tu empresa");

    const contrato = await prisma.contratoComercial.findFirst({
      where: { id: contratoId, empresaId, clienteId },
      select: {
        id: true, estadoContrato: true, estadoPoder: true,
        tipoCobroAcordado: true, valorAcordado: true, porcentajeAcordado: true,
      },
    });
    if (!contrato) throw new HttpError(400, "El contrato no pertenece a tu empresa/cliente");
    if (contrato.estadoContrato !== "FIRMADO" || contrato.estadoPoder !== "FIRMADO") {
      throw new HttpError(400, "El contrato y el poder deben estar firmados");
    }

    // Snapshot de cobro (headline, sin Decimals crudos en el JSON).
    const config = await prisma.configuracionCobro.findUnique({ where: { contratoId } });
    const cobroSnapshot = {
      tipoCobroAcordado: contrato.tipoCobroAcordado,
      valorAcordado: contrato.valorAcordado?.toString() ?? null,
      porcentajeAcordado: contrato.porcentajeAcordado?.toString() ?? null,
      tieneConfigDetallada: !!config,
    };

    try {
      const solicitud = await prisma.solicitudAsignacionProceso.create({
        data: {
          empresaId,
          clienteId,
          contratoId,
          tipoProcesoId: tipoProcesoId ?? cliente.necesidadTipoProcesoId,
          resumenCaso: cliente.resumenCaso,
          cobroSnapshot: cobroSnapshot as Prisma.InputJsonValue,
          solicitadoPorId: req.user!.sub,
          ...rest, // prioridad, jurisdiccionSugerida, rolParteSugerido, tituloPropuesto, notaComercial, tareasDefinidas
        },
      });
      res.status(201).json(solicitud);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, "Ya existe una solicitud para este contrato");
      }
      throw err;
    }
  }),
);

/** GET /comercial/solicitudes?estado= — bandeja del admin. */
comercialRoutes.get(
  "/solicitudes",
  requireAuth,
  requirePermiso("comercial.solicitud.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
    res.json(
      await prisma.solicitudAsignacionProceso.findMany({
        where: { empresaId, ...(estado ? { estado: estado as never } : {}) },
        orderBy: { fechaSolicitud: "desc" },
      }),
    );
  }),
);

/**
 * POST /comercial/solicitudes/:id/asignar — (solo ADMINISTRADOR vía RBAC).
 * Materializa el Proceso + ParteProceso desde la solicitud, en una transacción.
 */
comercialRoutes.post(
  "/solicitudes/:id/asignar",
  requireAuth,
  requirePermiso("comercial.solicitud.asignar"),
  validate({ params: idParams, body: asignarSolicitudSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { abogadoAsignadoId, tipoProcesoId: override, tareasDefinidas } = req.body;

    const solicitud = await prisma.solicitudAsignacionProceso.findFirst({
      where: { id: req.params.id, empresaId },
    });
    if (!solicitud) throw new HttpError(404, "Solicitud no encontrada");
    if (solicitud.estado !== "PENDIENTE" && solicitud.estado !== "EN_REVISION") {
      throw new HttpError(409, "La solicitud ya fue resuelta");
    }

    // El abogado debe ser USUARIO de la empresa con rol JURIDICO.
    const abogado = await prisma.usuarioRolEmpresa.findFirst({
      where: { usuarioId: abogadoAsignadoId, empresaId, rolEmpresa: "JURIDICO" },
      select: { id: true },
    });
    if (!abogado) {
      throw new HttpError(400, "El abogado asignado debe tener el rol JURIDICO en tu empresa");
    }

    // Tipo de proceso: override del admin ?? el sugerido por comercial.
    const tipoProcesoId = override ?? solicitud.tipoProcesoId;
    if (!tipoProcesoId) throw new HttpError(400, "Debes indicar un tipo de proceso");
    const tipo = await prisma.tipoProceso.findUnique({ where: { id: tipoProcesoId } });
    if (!tipo || (tipo.empresaId !== null && tipo.empresaId !== empresaId)) {
      throw new HttpError(400, "El tipo de proceso no es válido para tu empresa");
    }
    const entrada = etapaEntrada(tipo.etapas as unknown as EtapaDef[]);
    if (!entrada) throw new HttpError(400, "El tipo de proceso no define etapas");

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: solicitud.clienteId } });

    const result = await prisma.$transaction(async (tx) => {
      const litiganteId = await findOrCreateLitiganteByDoc(tx, cliente);
      if (!cliente.litiganteId) {
        await tx.cliente.update({ where: { id: cliente.id }, data: { litiganteId } });
      }
      const codigoInterno = await generarCodigoInterno(tx, empresaId, "COM");
      const proceso = await tx.proceso.create({
        data: {
          empresaId,
          tipoProcesoId: tipo.id,
          tipoEsquemaVersion: tipo.esquemaVersion,
          jurisdiccion: tipo.jurisdiccion, // del tipo, NO de la sugerida
          codigoInterno,
          titulo: solicitud.tituloPropuesto ?? cliente.nombre,
          estado: "ABIERTO",
          prioridad: solicitud.prioridad ?? "MEDIA",
          responsableId: abogadoAsignadoId,
          creadoPorId: req.user!.sub,
          datos: {} as Prisma.InputJsonValue, // ningún campo del embudo mapea al esquema dinámico
          etapaActual: entrada.key,
          historial: { create: { etapaKey: entrada.key, usuarioId: req.user!.sub } },
        },
      });
      await tx.parteProceso.create({
        data: {
          procesoId: proceso.id,
          litiganteId,
          rol: solicitud.rolParteSugerido ?? "DEMANDANTE", // default cuando no se sugirió
          esNuestroCliente: true,
        },
      });
      const upd = await tx.solicitudAsignacionProceso.update({
        where: { id: solicitud.id },
        data: {
          estado: "ASIGNADA",
          procesoId: proceso.id,
          abogadoAsignadoId,
          asignadoPorId: req.user!.sub,
          tareasDefinidas: tareasDefinidas ?? solicitud.tareasDefinidas,
          fechaAsignacion: new Date(),
        },
      });
      return { solicitud: upd, proceso };
    });
    res.status(201).json(result);
  }),
);

/** POST /comercial/solicitudes/:id/rechazar — (solo ADMINISTRADOR vía RBAC). */
comercialRoutes.post(
  "/solicitudes/:id/rechazar",
  requireAuth,
  requirePermiso("comercial.solicitud.rechazar"),
  validate({ params: idParams, body: rechazarSolicitudSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.solicitudAsignacionProceso.updateMany({
      where: { id: req.params.id, empresaId, estado: { in: ["PENDIENTE", "EN_REVISION"] } },
      data: { estado: "RECHAZADA", motivoRechazo: req.body.motivoRechazo },
    });
    if (count === 0) throw new HttpError(409, "La solicitud no existe o ya fue resuelta");
    res.json(await prisma.solicitudAsignacionProceso.findUnique({ where: { id: req.params.id } }));
  }),
);

// ===================== CARTERA (resumen de cobro en la ficha) =====================
/** GET /comercial/clientes/:id/cartera — resumen de cobro del cliente (solo lectura).
 *  Bajo el módulo comercial (NO exige el módulo contable); reusa la derivación de saldos. */
comercialRoutes.get(
  "/clientes/:id/cartera",
  requireAuth,
  requirePermiso("comercial.cobro.ver"),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    await assertCliente(empresaId, req.params.id);
    const filas = await prisma.cartera.findMany({
      where: { empresaId, clienteId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(await Promise.all(filas.map(conSaldo)));
  }),
);

// ===================== COMISIONES (internas del despacho, MANUAL) =====================
/** GET /comercial/comisiones — el ADMINISTRADOR ve todas (filtros opcionales);
 *  el COMERCIAL solo las suyas (acotado por comercialId = su id). */
comercialRoutes.get(
  "/comisiones",
  requireAuth,
  requirePermiso("comercial.comision.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { clienteId, comercialId, estado } = req.query as Record<string, string | undefined>;
    // Acotamiento por fila (RBAC no lo expresa): un no-admin solo ve lo suyo.
    const dueño = req.esAdminEmpresa ? (comercialId ? { comercialId } : {}) : { comercialId: req.user!.sub };
    const comisiones = await prisma.comisionDespacho.findMany({
      where: { empresaId, ...dueño, ...(clienteId ? { clienteId } : {}), ...(estado ? { estado: estado as never } : {}) },
      orderBy: { createdAt: "desc" },
    });
    res.json(comisiones);
  }),
);

/** POST /comercial/comisiones — (solo ADMINISTRADOR vía RBAC). */
comercialRoutes.post(
  "/comisiones",
  requireAuth,
  requirePermiso("comercial.comision.crear"),
  validate({ body: createComisionSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    await assertCliente(empresaId, req.body.clienteId);
    // El comercial debe ser un usuario de la empresa.
    const u = await prisma.usuario.findFirst({ where: { id: req.body.comercialId, empresaId }, select: { id: true } });
    if (!u) throw new HttpError(400, "El comercial no pertenece a tu empresa");
    const comision = await prisma.comisionDespacho.create({
      data: { ...req.body, empresaId, registradoPorId: req.user!.sub },
    });
    res.status(201).json(comision);
  }),
);

/** PATCH /comercial/comisiones/:id — (solo ADMINISTRADOR vía RBAC). */
comercialRoutes.patch(
  "/comisiones/:id",
  requireAuth,
  requirePermiso("comercial.comision.editar"),
  validate({ params: idParams, body: updateComisionSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const { count } = await prisma.comisionDespacho.updateMany({
      where: { id: req.params.id, empresaId },
      data: req.body,
    });
    if (count === 0) throw new HttpError(404, "Comisión no encontrada");
    res.json(await prisma.comisionDespacho.findUnique({ where: { id: req.params.id } }));
  }),
);
