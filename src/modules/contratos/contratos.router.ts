// Contratos (RRHH del personal). Router FINO: HTTP + auth/validate + multer; el
// ámbito (plataforma/empresa), la autorización y la lógica viven en contratos.service.
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import { validate } from "../../middleware/validate";
import { tenant } from "../../shared/tenant";
import {
  contratoIdParams, createContratoSchema, createDocumentoSchema, documentoIdParams, updateContratoSchema,
} from "./contratos.schemas";
import * as contratos from "./contratos.service";

export const contratoRoutes: Router = Router();

/** GET /contratos/mio — los contratos de la persona logueada (su historial). */
contratoRoutes.get("/mio", requireAuth,
  asyncHandler(async (req, res) => res.json(await contratos.listMios(tenant(req)))));

/** GET /contratos/reportes — conteos por estado + vencimientos próximos del ámbito. */
contratoRoutes.get("/reportes", requireAuth,
  asyncHandler(async (req, res) => res.json(await contratos.reportes(tenant(req)))));

/** GET /contratos — lista los contratos del ámbito del gestor. */
contratoRoutes.get("/", requireAuth,
  asyncHandler(async (req, res) => res.json(await contratos.listContratos(tenant(req)))));

/** POST /contratos — crea un contrato en el ámbito del gestor. */
contratoRoutes.post("/", requireAuth, validate({ body: createContratoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contratos.createContrato(tenant(req), req.body))));

/** GET /contratos/:id — un contrato (gestor o dueño). */
contratoRoutes.get("/:id", requireAuth, validate({ params: contratoIdParams }),
  asyncHandler(async (req, res) => res.json(await contratos.getContrato(tenant(req), req.params.id))));

/** PATCH /contratos/:id — edita un contrato (solo el gestor). */
contratoRoutes.patch("/:id", requireAuth, validate({ params: contratoIdParams, body: updateContratoSchema }),
  asyncHandler(async (req, res) => res.json(await contratos.updateContrato(tenant(req), req.params.id, req.body))));

/** DELETE /contratos/:id — elimina un contrato (solo el gestor). */
contratoRoutes.delete("/:id", requireAuth, validate({ params: contratoIdParams }),
  asyncHandler(async (req, res) => { await contratos.deleteContrato(tenant(req), req.params.id); res.status(204).end(); }));

/** POST /contratos/:id/documentos — sube un archivo (gestor o dueño). */
contratoRoutes.post("/:id/documentos", requireAuth, upload.single("file"), validate({ params: contratoIdParams, body: createDocumentoSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await contratos.subirDocumentoContrato(tenant(req), req.params.id, req.file, req.body))));

/** DELETE /contratos/:id/documentos/:docId — quita la metadata de un documento. */
contratoRoutes.delete("/:id/documentos/:docId", requireAuth, validate({ params: documentoIdParams }),
  asyncHandler(async (req, res) => { await contratos.eliminarDocumentoContrato(tenant(req), req.params.id, req.params.docId); res.status(204).end(); }));
