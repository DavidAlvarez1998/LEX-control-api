// Auth. Router FINO: HTTP + validate; la lógica vive en auth.service (login/me/
// setPassword) y el acceso a datos en auth.repository. Las primitivas cripto
// (hash/sign/verify) siguen en auth.service para sus consumidores (middleware, etc.).
import { Router } from "express";
import { asyncHandler } from "../../middleware/async";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { loginSchema, setPasswordSchema } from "./auth.schemas";
import * as auth from "./auth.service";

export const authRoutes: Router = Router();

/** POST /auth/login — verifica credenciales y devuelve un JWT. */
authRoutes.post(
  "/login",
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => res.json(await auth.login(req.body))),
);

/** GET /auth/me — usuario autenticado con datos frescos (forma igual a /login). */
authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => res.json(await auth.me(req.user!.sub))),
);

/** POST /auth/set-password — activa la cuenta con el token y define la contraseña. */
authRoutes.post(
  "/set-password",
  validate({ body: setPasswordSchema }),
  asyncHandler(async (req, res) => res.json(await auth.setPassword(req.body))),
);
