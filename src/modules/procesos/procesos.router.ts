import { Router } from "express";
import { EstadoProceso, Prisma } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  type CampoEsquema,
  type EtapaDef,
  etapaEntrada,
  validarDatosContraEsquema,
} from "./esquema";
import {
  createProcesoSchema,
  moverEtapaSchema,
  procesoIdParams,
  updateProcesoSchema,
} from "./procesos.schemas";
import { generarCodigoInterno } from "./procesos.service";

export const procesoRoutes: Router = Router();

const detalleInclude = {
  tipoProceso: { include: { areas: { include: { area: true } } } },
  partes: { include: { litigante: true } },
  historial: { orderBy: { createdAt: "asc" } },
  responsable: { select: { id: true, nombre: true } },
} as const;

/** GET /procesos — procesos del despacho, con filtros y paginación. */
procesoRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const where: Prisma.ProcesoWhereInput = {
      empresaId,
      ...(req.query.estado ? { estado: req.query.estado as EstadoProceso } : {}),
      ...(req.query.responsableId ? { responsableId: String(req.query.responsableId) } : {}),
      ...(req.query.radicado ? { radicado: String(req.query.radicado) } : {}),
      ...(req.query.area
        ? { tipoProceso: { areas: { some: { area: { slug: String(req.query.area) } } } } }
        : {}),
      ...(req.query.litiganteId
        ? { partes: { some: { litiganteId: String(req.query.litiganteId) } } }
        : {}),
    };

    const [total, procesos] = await Promise.all([
      prisma.proceso.count({ where }),
      prisma.proceso.findMany({
        where,
        include: { tipoProceso: { include: { areas: { include: { area: true } } } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      total,
      page,
      pageSize,
      items: procesos.map((t) => ({
        id: t.id,
        codigoInterno: t.codigoInterno,
        radicado: t.radicado,
        titulo: t.titulo,
        tipoProcesoNombre: t.tipoProceso.nombre,
        jurisdiccion: t.jurisdiccion,
        areaSlug: t.tipoProceso.areas[0]?.area.slug ?? null,
        estado: t.estado,
        prioridad: t.prioridad,
        proximaAudiencia: t.proximaAudiencia,
      })),
    });
  }),
);

/** GET /procesos/:id — un proceso del despacho con todo su detalle. */
procesoRoutes.get(
  "/:id",
  requireAuth,
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const proceso = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      include: detalleInclude,
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");
    res.json(proceso);
  }),
);

/** POST /procesos — crea un proceso (atómico: proceso + partes + 1ª etapa). */
procesoRoutes.post(
  "/",
  requireAuth,
  validate({ body: createProcesoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const body = req.body as import("zod").infer<typeof createProcesoSchema>;

    // El tipo debe ser visible para el despacho (global o propio).
    const tipo = await prisma.tipoProceso.findUnique({ where: { id: body.tipoProcesoId } });
    if (!tipo || (tipo.empresaId !== null && tipo.empresaId !== empresaId)) {
      throw new HttpError(404, "Tipo de proceso no encontrado");
    }

    const esquema = tipo.esquemaFormulario as unknown as CampoEsquema[];
    const { ok, faltantes, errores } = validarDatosContraEsquema(esquema, body.datos);
    if (!ok) {
      throw new HttpError(400, "Datos del formulario inválidos", { faltantes, errores });
    }

    const entrada = etapaEntrada(tipo.etapas as unknown as EtapaDef[]);
    if (!entrada) throw new HttpError(400, "El tipo de proceso no define etapas");

    // Caso relacionado (tutela → caso base) debe ser del mismo despacho.
    if (body.casoRelacionadoId) {
      const base = await prisma.proceso.findFirst({
        where: { id: body.casoRelacionadoId, empresaId },
        select: { id: true },
      });
      if (!base) throw new HttpError(400, "El caso relacionado no existe en tu despacho");
    }

    const proceso = await prisma.$transaction(async (tx) => {
      // codigoInterno secuencial por empresa y año (el @@unique respalda la carrera).
      const codigoInterno = await generarCodigoInterno(tx, empresaId);

      const creado = await tx.proceso.create({
        data: {
          codigoInterno,
          radicado: body.radicado,
          empresaId,
          tipoProcesoId: tipo.id,
          tipoEsquemaVersion: tipo.esquemaVersion,
          jurisdiccion: tipo.jurisdiccion,
          instancia: body.instancia,
          cuantiaTipo: body.cuantiaTipo,
          cuantiaValor: body.cuantiaValor != null ? new Prisma.Decimal(body.cuantiaValor) : null,
          despachoJuzgado: body.despachoJuzgado,
          casoRelacionadoId: body.casoRelacionadoId,
          creadoPorId: req.user!.sub,
          titulo: body.titulo,
          datos: body.datos as Prisma.InputJsonValue,
          etapaActual: entrada.key,
          historial: { create: { etapaKey: entrada.key, usuarioId: req.user!.sub } },
        },
      });

      for (const p of body.partes) {
        let litiganteId = p.litiganteId;
        if (litiganteId) {
          const lit = await tx.litigante.findFirst({
            where: { id: litiganteId, empresaId },
            select: { id: true },
          });
          if (!lit) throw new HttpError(400, "Un litigante no pertenece a tu despacho");
        } else if (p.litigante) {
          const nuevo = await tx.litigante.create({ data: { ...p.litigante, empresaId } });
          litiganteId = nuevo.id;
        }
        await tx.parteProceso.create({
          data: {
            procesoId: creado.id,
            litiganteId: litiganteId!,
            rol: p.rol,
            rolEtiqueta: p.rolEtiqueta,
            esNuestroCliente: p.esNuestroCliente,
          },
        });
      }

      return tx.proceso.findUnique({ where: { id: creado.id }, include: detalleInclude });
    });

    res.status(201).json(proceso);
  }),
);

/** PATCH /procesos/:id/etapa — mueve el proceso a una etapa (rule-gated). */
procesoRoutes.patch(
  "/:id/etapa",
  requireAuth,
  validate({ params: procesoIdParams, body: moverEtapaSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const proceso = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      include: { tipoProceso: { select: { etapas: true } } },
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");
    if (proceso.estado === "CERRADO" || proceso.estado === "ARCHIVADO") {
      throw new HttpError(400, "El proceso está cerrado; reábrelo para mover etapas");
    }

    const etapas = proceso.tipoProceso.etapas as unknown as EtapaDef[];
    const destino = etapas.find((e) => e.key === req.body.etapaKey);
    if (!destino) throw new HttpError(400, "Etapa inválida para este tipo de proceso");

    // Reglas de la etapa destino: campos requeridos presentes en `datos`.
    const datos = proceso.datos as Record<string, unknown>;
    const faltantes: string[] = [];
    for (const k of destino.reglas?.camposRequeridos ?? []) {
      const v = datos[k];
      if (v === undefined || v === null || v === "") faltantes.push(k);
    }
    if (faltantes.length > 0) {
      throw new HttpError(400, "No puedes avanzar: faltan datos requeridos", { faltantes });
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      await tx.etapaProceso.create({
        data: { procesoId: proceso.id, etapaKey: destino.key, nota: req.body.nota, usuarioId: req.user!.sub },
      });
      return tx.proceso.update({
        where: { id: proceso.id },
        data: {
          etapaActual: destino.key,
          estado: destino.terminal ? "CERRADO" : "EN_PROCESO",
        },
        include: detalleInclude,
      });
    });
    res.json(actualizado);
  }),
);

/** PATCH /procesos/:id — actualiza campos (responsable, radicado, cuantía, estado…). */
procesoRoutes.patch(
  "/:id",
  requireAuth,
  validate({ params: procesoIdParams, body: updateProcesoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const existe = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true },
    });
    if (!existe) throw new HttpError(404, "Proceso no encontrado");

    const body = req.body as import("zod").infer<typeof updateProcesoSchema>;

    // El responsable debe ser un usuario del mismo despacho.
    if (body.responsableId) {
      const resp = await prisma.usuario.findFirst({
        where: { id: body.responsableId, empresaId },
        select: { id: true },
      });
      if (!resp) throw new HttpError(400, "El responsable no pertenece a tu despacho");
    }

    const data: Prisma.ProcesoUpdateInput = {
      ...(body.titulo !== undefined ? { titulo: body.titulo } : {}),
      ...(body.radicado !== undefined ? { radicado: body.radicado } : {}),
      ...(body.despachoJuzgado !== undefined ? { despachoJuzgado: body.despachoJuzgado } : {}),
      ...(body.instancia !== undefined ? { instancia: body.instancia } : {}),
      ...(body.cuantiaTipo !== undefined ? { cuantiaTipo: body.cuantiaTipo } : {}),
      ...(body.cuantiaValor !== undefined
        ? { cuantiaValor: body.cuantiaValor != null ? new Prisma.Decimal(body.cuantiaValor) : null }
        : {}),
      ...(body.proximaAudiencia !== undefined
        ? { proximaAudiencia: body.proximaAudiencia ? new Date(body.proximaAudiencia) : null }
        : {}),
      ...(body.estado !== undefined ? { estado: body.estado } : {}),
      ...(body.prioridad !== undefined ? { prioridad: body.prioridad } : {}),
      ...(body.responsableId !== undefined
        ? {
            responsable: body.responsableId
              ? { connect: { id: body.responsableId } }
              : { disconnect: true },
          }
        : {}),
    };

    const proceso = await prisma.proceso.update({
      where: { id: existe.id },
      data,
      include: detalleInclude,
    });
    res.json(proceso);
  }),
);
