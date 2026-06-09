import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { corteConstitucionalAdapter } from "./corteConstitucional.client";
import { jurisprudenciaQuerySchema } from "./integraciones.schemas";

export const integracionRoutes: Router = Router();

/**
 * GET /integraciones/jurisprudencia?q=&limite= — consulta jurisprudencia de la
 * Corte Constitucional (proveedor `api`, datos.gov.co). Devuelve resultados
 * normalizados (JurisprudenciaDTO). Solo lectura; cualquier usuario autenticado.
 */
integracionRoutes.get(
  "/jurisprudencia",
  requireAuth,
  validate({ query: jurisprudenciaQuerySchema }),
  asyncHandler(async (req, res) => {
    // `validate` ya verificó la query; re-parseamos para obtener `limite` coercionado
    // a número (validate no reescribe req.query, que llega como strings).
    const { q, limite } = jurisprudenciaQuerySchema.parse(req.query);
    const resultados = await corteConstitucionalAdapter.buscarJurisprudencia(q, limite);
    res.json({ fuente: corteConstitucionalAdapter.nombre, total: resultados.length, resultados });
  }),
);
