import { Router } from "express";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import { loginSchema } from "./auth.schemas";
import { signToken, verifyPassword } from "./auth.service";

export const authRoutes: Router = Router();

/** POST /auth/login — verifica credenciales y devuelve un JWT. */
authRoutes.post(
  "/login",
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Mensaje genérico: no revela si el problema es el email o la contraseña.
    const invalidas = new HttpError(401, "Credenciales inválidas");

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !usuario.activo) throw invalidas;

    const ok = await verifyPassword(password, usuario.password);
    if (!ok) throw invalidas;

    const token = signToken({ sub: usuario.id, rol: usuario.rol });
    res.json({
      token,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    });
  }),
);
