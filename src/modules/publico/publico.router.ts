// Endpoints PÚBLICOS (sin auth) de la landing. Router FINO: HTTP + validate; la
// lógica vive en publico.service. Ver openspec public-marketing-api.
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { validate } from "../../middleware/validate";
import { solicitudCuentaSchema } from "./publico.schemas";
import * as publico from "./publico.service";

export const publicoRoutes: Router = Router();

/** GET /publico/planes — catálogo de planes para la landing (solo lectura). */
publicoRoutes.get(
  "/planes",
  asyncHandler(async (_req, res) => res.json(await publico.listPlanes())),
);

/** POST /publico/solicitud-cuenta — solicitud de creación de cuenta (crea Prospecto). */
publicoRoutes.post(
  "/solicitud-cuenta",
  validate({ body: solicitudCuentaSchema }),
  asyncHandler(async (req, res) => {
    const { creado } = await publico.solicitarCuenta(req.body);
    res.status(creado ? 201 : 200).json({ ok: true });
  }),
);
