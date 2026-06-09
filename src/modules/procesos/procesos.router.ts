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
  evaluarCondicion,
  validarDatosContraEsquema,
} from "./esquema";
import { derivarFechaLimite, sumarDiasHabiles } from "./diasHabiles";
import {
  adjuntarDocumentoSchema,
  createProcesoSchema,
  documentoIdParams,
  generarDocumentoSchema,
  moverEtapaSchema,
  procesoIdParams,
  updateDocumentoSchema,
  updateProcesoSchema,
} from "./procesos.schemas";
import { generarCodigoInterno } from "./procesos.service";
import { construirContexto, renderPlantilla } from "./plantilla";

export const procesoRoutes: Router = Router();

const detalleInclude = {
  tipoProceso: { include: { areas: { include: { area: true } } } },
  partes: { include: { litigante: true } },
  historial: { orderBy: { createdAt: "asc" } },
  responsable: { select: { id: true, nombre: true } },
  documentos: { orderBy: { createdAt: "desc" } },
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

/**
 * GET /procesos/vencimientos — procesos abiertos del despacho clasificados por
 * estado del vencimiento (semáforo): vencido / por_vencer (≤ 3 días hábiles) /
 * al_dia (incluye los que no tienen fechaLimite). Se declara ANTES de `/:id`
 * para que no lo capture esa ruta paramétrica.
 */
procesoRoutes.get(
  "/vencimientos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const procesos = await prisma.proceso.findMany({
      where: { empresaId, estado: { notIn: ["CERRADO", "ARCHIVADO"] } },
      select: {
        id: true,
        codigoInterno: true,
        radicado: true,
        titulo: true,
        etapaActual: true,
        estado: true,
        fechaLimite: true,
      },
      orderBy: { fechaLimite: { sort: "asc", nulls: "last" } },
    });

    // Hoy a medianoche UTC; "por vencer" = vence dentro de 3 días hábiles.
    const ahora = new Date();
    const hoy = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
    const limitePorVencer = sumarDiasHabiles(hoy, 3);
    const semaforo = (f: Date | null): "vencido" | "por_vencer" | "al_dia" => {
      if (!f) return "al_dia";
      if (f < hoy) return "vencido";
      return f <= limitePorVencer ? "por_vencer" : "al_dia";
    };
    const items = procesos.map((p) => ({ ...p, semaforo: semaforo(p.fechaLimite) }));

    res.json({
      vencido: items.filter((i) => i.semaforo === "vencido"),
      por_vencer: items.filter((i) => i.semaforo === "por_vencer"),
      al_dia: items.filter((i) => i.semaforo === "al_dia"),
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
      include: {
        tipoProceso: { select: { etapas: true } },
        documentos: { select: { nombre: true } },
      },
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");
    if (proceso.estado === "CERRADO" || proceso.estado === "ARCHIVADO") {
      throw new HttpError(400, "El proceso está cerrado; reábrelo para mover etapas");
    }

    const etapas = proceso.tipoProceso.etapas as unknown as EtapaDef[];
    const destino = etapas.find((e) => e.key === req.body.etapaKey);
    if (!destino) throw new HttpError(400, "Etapa inválida para este tipo de proceso");

    const datos = proceso.datos as Record<string, unknown>;

    // Ramificación por valor: la etapa destino solo se ofrece si su `disponibleSi`
    // se cumple con los datos actuales (p. ej. "escala_tutela" solo si contestaron=NO).
    if (destino.disponibleSi && !evaluarCondicion(destino.disponibleSi, datos)) {
      throw new HttpError(422, "Esa etapa no está disponible con los datos actuales del proceso", {
        condicion: destino.disponibleSi,
      });
    }

    // Requisitos de la etapa destino: campos y documentos requeridos, incluyendo
    // los condicionales (`requeridosSi`) cuya condición se cumple ahora.
    const reglas = destino.reglas;
    const camposReq = [
      ...(reglas?.camposRequeridos ?? []),
      ...(reglas?.requeridosSi ?? [])
        .filter((r) => evaluarCondicion(r.si, datos))
        .flatMap((r) => r.camposRequeridos ?? []),
    ];
    const docsReq = [
      ...(reglas?.documentosRequeridos ?? []),
      ...(reglas?.requeridosSi ?? [])
        .filter((r) => evaluarCondicion(r.si, datos))
        .flatMap((r) => r.documentosRequeridos ?? []),
    ];

    const faltantes = [...new Set(camposReq)].filter((k) => {
      const v = datos[k];
      return v === undefined || v === null || v === "";
    });

    // Documentos presentes en el expediente (adjuntos o generados), por nombre
    // (insensible a mayúsculas/espacios).
    const docsPresentes = new Set(proceso.documentos.map((d) => d.nombre.trim().toLowerCase()));
    const documentosFaltantes = [...new Set(docsReq)].filter(
      (nombre) => !docsPresentes.has(nombre.trim().toLowerCase()),
    );

    if (faltantes.length > 0 || documentosFaltantes.length > 0) {
      throw new HttpError(400, "No puedes avanzar: faltan requisitos", {
        faltantes,
        documentosFaltantes,
      });
    }

    // Vencimiento: si la etapa destino define un plazo y es una transición real
    // (cambia de etapa), se deriva fechaLimite. No se recalcula al re-entrar a la
    // misma etapa, para no pisar un override manual.
    const esTransicion = destino.key !== proceso.etapaActual;
    const nuevaFechaLimite =
      esTransicion && reglas?.plazoDesdeCampo ? derivarFechaLimite(reglas, datos) : undefined;

    const actualizado = await prisma.$transaction(async (tx) => {
      await tx.etapaProceso.create({
        data: { procesoId: proceso.id, etapaKey: destino.key, nota: req.body.nota, usuarioId: req.user!.sub },
      });
      return tx.proceso.update({
        where: { id: proceso.id },
        data: {
          etapaActual: destino.key,
          estado: destino.terminal ? "CERRADO" : "EN_PROCESO",
          ...(nuevaFechaLimite !== undefined ? { fechaLimite: nuevaFechaLimite } : {}),
        },
        include: detalleInclude,
      });
    });
    res.json(actualizado);
  }),
);

/**
 * POST /procesos/:id/derivar — ejecuta la acción `crearDerivado` de la etapa
 * actual: crea un proceso del tipo destino (global) ligado a este como caso base
 * (`casoRelacionadoId`). Idempotente: un solo derivado por (caso base, tipo) → 409.
 */
procesoRoutes.post(
  "/:id/derivar",
  requireAuth,
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const proceso = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      include: { tipoProceso: { select: { etapas: true } } },
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");

    const etapas = proceso.tipoProceso.etapas as unknown as EtapaDef[];
    const accion = etapas.find((e) => e.key === proceso.etapaActual)?.accion;
    if (!accion || accion.tipo !== "crearDerivado") {
      throw new HttpError(400, "La etapa actual no define una acción de derivación");
    }

    // El destino debe ser un tipo de proceso GLOBAL existente.
    const tipoDestino = await prisma.tipoProceso.findFirst({
      where: { empresaId: null, nombre: accion.tipoDestinoNombre },
    });
    if (!tipoDestino) {
      throw new HttpError(422, `No existe el tipo global "${accion.tipoDestinoNombre}"`);
    }

    // Idempotencia: un único derivado por (caso base, tipo destino).
    const existente = await prisma.proceso.findFirst({
      where: { empresaId, casoRelacionadoId: proceso.id, tipoProcesoId: tipoDestino.id },
      select: { id: true, codigoInterno: true },
    });
    if (existente) {
      throw new HttpError(409, "Ya existe un proceso derivado de este tipo", {
        procesoId: existente.id,
        codigoInterno: existente.codigoInterno,
      });
    }

    const entrada = etapaEntrada(tipoDestino.etapas as unknown as EtapaDef[]);
    if (!entrada) throw new HttpError(400, "El tipo destino no define etapas");

    const derivado = await prisma.$transaction(async (tx) => {
      const codigoInterno = await generarCodigoInterno(tx, empresaId);
      const creado = await tx.proceso.create({
        data: {
          codigoInterno,
          empresaId,
          tipoProcesoId: tipoDestino.id,
          tipoEsquemaVersion: tipoDestino.esquemaVersion,
          jurisdiccion: tipoDestino.jurisdiccion,
          casoRelacionadoId: proceso.id,
          creadoPorId: req.user!.sub,
          titulo: `${tipoDestino.nombre} — ${proceso.titulo}`,
          datos: {},
          etapaActual: entrada.key,
          historial: { create: { etapaKey: entrada.key, usuarioId: req.user!.sub } },
        },
      });
      return tx.proceso.findUnique({ where: { id: creado.id }, include: detalleInclude });
    });
    res.status(201).json(derivado);
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
      select: { id: true, tipoProceso: { select: { esquemaFormulario: true } } },
    });
    if (!existe) throw new HttpError(404, "Proceso no encontrado");

    const body = req.body as import("zod").infer<typeof updateProcesoSchema>;

    // Editar el formulario dinámico: se valida contra el esquema del tipo, pero
    // se permite guardar incompleto (los requeridos se exigen al avanzar etapa).
    if (body.datos !== undefined) {
      const esquema = existe.tipoProceso.esquemaFormulario as unknown as CampoEsquema[];
      const { ok, errores, faltantes } = validarDatosContraEsquema(esquema, body.datos, {
        exigirRequeridos: false,
      });
      if (!ok) throw new HttpError(400, "Datos del formulario inválidos", { faltantes, errores });
    }

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
      ...(body.fechaLimite !== undefined
        ? { fechaLimite: body.fechaLimite ? new Date(body.fechaLimite) : null }
        : {}),
      ...(body.datos !== undefined ? { datos: body.datos as Prisma.InputJsonValue } : {}),
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

// ===================== DOCUMENTOS DEL EXPEDIENTE =====================

/** GET /procesos/:id/plantillas — plantillas del tipo del proceso (para el selector). */
procesoRoutes.get(
  "/:id/plantillas",
  requireAuth,
  validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const proceso = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      select: { tipoProcesoId: true },
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");
    const plantillas = await prisma.plantillaDocumento.findMany({
      where: { tipoProcesoId: proceso.tipoProcesoId },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
    res.json(plantillas);
  }),
);

/** POST /procesos/:id/documentos — adjunta un archivo (enlace) al expediente. */
procesoRoutes.post(
  "/:id/documentos",
  requireAuth,
  validate({ params: procesoIdParams, body: adjuntarDocumentoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const proceso = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true },
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");
    const doc = await prisma.documentoProceso.create({
      data: { procesoId: proceso.id, nombre: req.body.nombre, url: req.body.url },
    });
    res.status(201).json(doc);
  }),
);

/** POST /procesos/:id/documentos/generar — genera un borrador editable desde una plantilla. */
procesoRoutes.post(
  "/:id/documentos/generar",
  requireAuth,
  validate({ params: procesoIdParams, body: generarDocumentoSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const proceso = await prisma.proceso.findFirst({
      where: { id: req.params.id, empresaId },
      include: { partes: { include: { litigante: true } } },
    });
    if (!proceso) throw new HttpError(404, "Proceso no encontrado");

    // La plantilla debe ser del tipo del proceso (evita usar plantillas ajenas).
    const plantilla = await prisma.plantillaDocumento.findFirst({
      where: { id: req.body.plantillaId, tipoProcesoId: proceso.tipoProcesoId },
    });
    if (!plantilla) throw new HttpError(404, "Plantilla no encontrada para este tipo de proceso");

    const contenido = renderPlantilla(plantilla.contenido, construirContexto(proceso));
    const doc = await prisma.documentoProceso.create({
      data: {
        procesoId: proceso.id,
        nombre: req.body.nombre ?? plantilla.nombre,
        contenido,
        generadoDePlantilla: plantilla.id,
      },
    });
    res.status(201).json(doc);
  }),
);

/** PATCH /procesos/:id/documentos/:docId — edita el borrador (nombre/contenido). */
procesoRoutes.patch(
  "/:id/documentos/:docId",
  requireAuth,
  validate({ params: documentoIdParams, body: updateDocumentoSchema }),
  asyncHandler(async (req, res) => {
    const doc = await cargarDocumento(req);
    const actualizado = await prisma.documentoProceso.update({
      where: { id: doc.id },
      data: {
        ...(req.body.nombre !== undefined ? { nombre: req.body.nombre } : {}),
        ...(req.body.contenido !== undefined ? { contenido: req.body.contenido } : {}),
      },
    });
    res.json(actualizado);
  }),
);

/** DELETE /procesos/:id/documentos/:docId — elimina un documento del expediente. */
procesoRoutes.delete(
  "/:id/documentos/:docId",
  requireAuth,
  validate({ params: documentoIdParams }),
  asyncHandler(async (req, res) => {
    const doc = await cargarDocumento(req);
    await prisma.documentoProceso.delete({ where: { id: doc.id } });
    res.status(204).end();
  }),
);

/** Carga un documento verificando que su proceso pertenezca al despacho. */
async function cargarDocumento(req: import("express").Request) {
  const empresaId = empresaIdRequerido(req);
  const doc = await prisma.documentoProceso.findFirst({
    where: { id: req.params.docId, proceso: { id: req.params.id, empresaId } },
  });
  if (!doc) throw new HttpError(404, "Documento no encontrado");
  return doc;
}
