// Módulo de PROCESOS legales. Router FINO: HTTP + auth/requirePermiso/validate; toda
// la lógica (motor de etapas, transacciones, auto-título, documentos) vive en
// procesos.service, el acceso a datos en procesos.repository y el motor puro en
// maquina-etapas.ts. Tenant-scoped (empresaId del token).
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requirePermiso } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  addParteSchema, adjuntarDocumentoSchema, createProcesoSchema, documentoIdParams,
  generarDocumentoSchema, moverEtapaSchema, parteIdParams, procesoIdParams,
  updateDocumentoSchema, updateParteSchema, updateProcesoSchema,
} from "./procesos.schemas";
import * as procesos from "./procesos.service";
import * as actuaciones from "./actuaciones.service";

export const procesoRoutes: Router = Router();

// Subida de archivos del expediente (en memoria; el binario va a tecnovapp).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ===================== LISTA / VENCIMIENTOS / CÁLCULO =====================
procesoRoutes.get("/", requireAuth, requirePermiso("proceso.ver"),
  asyncHandler(async (req, res) => res.json(await procesos.listProcesos(tenant(req), req.query))));

procesoRoutes.get("/vencimientos", requireAuth, requirePermiso("proceso.ver"),
  asyncHandler(async (req, res) => res.json(await procesos.vencimientos(tenant(req)))));

procesoRoutes.post("/calcular-vencimiento", requireAuth,
  asyncHandler(async (req, res) => res.json(await procesos.calcularVencimiento(tenant(req), req.body))));

// ===================== RAMA JUDICIAL (actuaciones) =====================
// Validar un radicado contra la Rama al pegarlo (Endpoint A). Va ANTES de "/:id".
procesoRoutes.get("/validar-radicado", requireAuth, requirePermiso("proceso.ver"),
  asyncHandler(async (req, res) => res.json(await actuaciones.validarRadicado(String(req.query.radicado ?? "")))));

// P16: actualizar (sincronizar) mis procesos con radicado de un tirón. Va ANTES de "/:id".
procesoRoutes.post("/rama/sincronizar-mis", requireAuth, requirePermiso("proceso.editar"),
  asyncHandler(async (req, res) => res.json(await actuaciones.sincronizarMisProcesos(tenant(req)))));

procesoRoutes.get("/:id/actuaciones", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.listarActuaciones(tenant(req), req.params.id))));

procesoRoutes.post("/:id/actuaciones/sincronizar", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.sincronizarActuaciones(tenant(req), req.params.id))));

procesoRoutes.post("/:id/actuaciones/marcar-vistas", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.marcarActuacionesVistas(tenant(req), req.params.id))));

procesoRoutes.get("/:id/actuaciones/sugerencias", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.sugerenciasDeProceso(tenant(req), req.params.id))));

// Estado/detalle del proceso en el juzgado (P11): ubicación, tipo/clase, última actualización.
procesoRoutes.get("/:id/rama/detalle", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.obtenerDetalleRama(tenant(req), req.params.id))));

// Partes que reporta la Rama: sugerir e importar como partes del proceso (P10).
procesoRoutes.get("/:id/rama/partes", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.sugerirPartesRama(tenant(req), req.params.id))));

procesoRoutes.post("/:id/rama/partes/importar", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.importarPartesRama(tenant(req), req.params.id, req.body?.nombres))));

// Documentos del expediente (Rama): listar disponibles e importar PDFs al proceso (P9).
procesoRoutes.get("/:id/rama/documentos", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.listarDocumentosRama(tenant(req), req.params.id))));

procesoRoutes.post("/:id/rama/documentos/importar", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await actuaciones.importarDocumentosRama(tenant(req), req.params.id, req.body?.idRegs))));

// ===================== CASO / DETALLE =====================
procesoRoutes.get("/:id/caso", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await procesos.getCaso(tenant(req), req.params.id))));

procesoRoutes.get("/:id", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await procesos.getDetalle(tenant(req), req.params.id))));

// ===================== CREAR / ETAPA / DERIVAR / EDITAR =====================
procesoRoutes.post("/", requireAuth, requirePermiso("proceso.editar"), validate({ body: createProcesoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await procesos.createProceso(tenant(req), req.body))));

procesoRoutes.patch("/:id/etapa", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams, body: moverEtapaSchema }),
  asyncHandler(async (req, res) => res.json(await procesos.moverEtapa(tenant(req), req.params.id, req.body))));

procesoRoutes.post("/:id/derivar", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.status(201).json(await procesos.derivar(tenant(req), req.params.id))));

procesoRoutes.patch("/:id", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams, body: updateProcesoSchema }),
  asyncHandler(async (req, res) => res.json(await procesos.updateProceso(tenant(req), req.params.id, req.body))));

// ===================== PARTES =====================
procesoRoutes.post("/:id/partes", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams, body: addParteSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await procesos.agregarParte(tenant(req), req.params.id, req.body))));

procesoRoutes.patch("/:id/partes/:parteId", requireAuth, requirePermiso("proceso.editar"), validate({ params: parteIdParams, body: updateParteSchema }),
  asyncHandler(async (req, res) => res.json(await procesos.editarParte(tenant(req), req.params.id, req.params.parteId, req.body))));

procesoRoutes.delete("/:id/partes/:parteId", requireAuth, requirePermiso("proceso.editar"), validate({ params: parteIdParams }),
  asyncHandler(async (req, res) => res.json(await procesos.eliminarParte(tenant(req), req.params.id, req.params.parteId))));

// ===================== PLANTILLAS / DOCUMENTOS =====================
procesoRoutes.get("/:id/plantillas", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.json(await procesos.listPlantillas(tenant(req), req.params.id))));

procesoRoutes.post("/:id/documentos", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams, body: adjuntarDocumentoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await procesos.adjuntarDocumento(tenant(req), req.params.id, req.body))));

procesoRoutes.post("/:id/documentos/generar", requireAuth, requirePermiso("proceso.editar"), validate({ params: procesoIdParams, body: generarDocumentoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await procesos.generarDocumento(tenant(req), req.params.id, req.body))));

procesoRoutes.post("/:id/documentos/render", requireAuth, requirePermiso("proceso.ver"), validate({ params: procesoIdParams, body: generarDocumentoSchema }),
  asyncHandler(async (req, res) => res.json(await procesos.renderDocumento(tenant(req), req.params.id, req.body))));

procesoRoutes.post("/:id/documentos/subir", requireAuth, requirePermiso("proceso.editar"), upload.single("file"), validate({ params: procesoIdParams }),
  asyncHandler(async (req, res) => res.status(201).json(await procesos.subirArchivo(tenant(req), req.params.id, req.file, req.body?.nombre))));

procesoRoutes.patch("/:id/documentos/:docId", requireAuth, requirePermiso("proceso.editar"), validate({ params: documentoIdParams, body: updateDocumentoSchema }),
  asyncHandler(async (req, res) => res.json(await procesos.editarDocumento(tenant(req), req.params.id, req.params.docId, req.body))));

procesoRoutes.delete("/:id/documentos/:docId", requireAuth, requirePermiso("proceso.editar"), validate({ params: documentoIdParams }),
  asyncHandler(async (req, res) => { await procesos.eliminarDocumento(tenant(req), req.params.id, req.params.docId); res.status(204).end(); }));
