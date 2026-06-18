// Búsqueda global (v1). Router FINO: HTTP + auth; la lógica consciente de rol vive
// en buscar.service y las queries en buscar.repository. La autorización por permiso
// se inyecta como callback `can` (reusa tienePermiso, que lee la empresa del token).
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, tienePermiso } from "../../middleware/auth";
import { tenant } from "../../shared/tenant";
import { buscar } from "./buscar.service";

export const buscarRoutes: Router = Router();

/** GET /buscar?q= — búsqueda global consciente del rol. */
buscarRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const resultado = await buscar(tenant(req), q, (clave) => tienePermiso(req, clave));
    res.json(resultado);
  }),
);
