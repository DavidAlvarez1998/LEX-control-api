import { Router } from "express";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { HttpError } from "../../middleware/error";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { loginSchema, setPasswordSchema } from "./auth.schemas";
import {
  hashActivationToken,
  hashPassword,
  signToken,
  verifyPassword,
} from "./auth.service";

export const authRoutes: Router = Router();

/** POST /auth/login — verifica credenciales y devuelve un JWT. */
authRoutes.post(
  "/login",
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password, audience } = req.body;

    // Mensaje genérico: no revela si el problema es el email o la contraseña.
    const invalidas = new HttpError(401, "Credenciales inválidas");

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      include: {
        empresa: { select: { nombre: true, activo: true } },
        rolesEmpresa: { select: { rolEmpresa: true } },
      },
    });
    if (!usuario || !usuario.activo) throw invalidas;
    // Cuenta pendiente (reset emitido o sin activar): la contraseña vieja ya no
    // sirve. Mismo 401 genérico para no revelar el estado de la cuenta.
    if (usuario.activationToken) throw invalidas;
    // Empresa desactivada: bloquea a TODOS sus usuarios. Los ADMIN de plataforma
    // no tienen empresa, así que nunca quedan bloqueados por esta regla.
    if (usuario.empresa && !usuario.empresa.activo) throw invalidas;

    const ok = await verifyPassword(password, usuario.password);
    if (!ok) throw invalidas;

    // Separación estricta de portales. El portal admin (audience ADMIN) admite los
    // roles de plataforma (ADMIN y COMERCIAL); el portal cliente (USUARIO) solo
    // admite USUARIO. Mismo 401 genérico para no filtrar que las credenciales servían.
    if (audience) {
      const rolesDelPortal = audience === "USUARIO" ? ["USUARIO"] : ["ADMIN", "COMERCIAL"];
      if (!rolesDelPortal.includes(usuario.rol)) throw invalidas;
    }

    const token = signToken({
      sub: usuario.id,
      rol: usuario.rol,
      tv: usuario.tokenVersion,
    });
    res.json({
      token,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        // Para el portal: distingue al admin de la empresa del usuario común.
        esAdminEmpresa: usuario.esAdminEmpresa,
        // Roles de empresa del usuario: el portal decide qué módulos mostrar.
        roles: usuario.rolesEmpresa.map((r) => r.rolEmpresa),
        // Nombre de la empresa del usuario (null para ADMIN de plataforma).
        empresa: usuario.empresa?.nombre ?? null,
      },
    });
  }),
);

/**
 * GET /auth/me — devuelve el usuario autenticado con sus datos FRESCOS de BD
 * (rol de plataforma, esAdminEmpresa, roles de empresa, empresa). El portal lo
 * usa para refrescar la sesión cacheada: cuando un admin de empresa cambia los
 * roles de un usuario, su sidebar y porteros se actualizan sin re-login. La
 * forma del `user` coincide con la de /auth/login.
 */
authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      include: {
        empresa: { select: { nombre: true } },
        rolesEmpresa: { select: { rolEmpresa: true } },
      },
    });
    // requireAuth ya validó la cuenta; si desapareció entre medias, 401.
    if (!usuario) throw new HttpError(401, "Token inválido o expirado");

    res.json({
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      esAdminEmpresa: usuario.esAdminEmpresa,
      roles: usuario.rolesEmpresa.map((r) => r.rolEmpresa),
      empresa: usuario.empresa?.nombre ?? null,
    });
  }),
);

/** POST /auth/set-password — activa la cuenta con el token y define la contraseña. */
authRoutes.post(
  "/set-password",
  validate({ body: setPasswordSchema }),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const hash = hashActivationToken(token);

    const usuario = await prisma.usuario.findUnique({
      where: { activationToken: hash },
    });
    if (
      !usuario ||
      !usuario.activationExpires ||
      usuario.activationExpires < new Date()
    ) {
      throw new HttpError(400, "El enlace de activación es inválido o expiró");
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        password: await hashPassword(password),
        activationToken: null,
        activationExpires: null,
        activo: true,
        // Invalida cualquier token emitido durante la ventana de pendiente.
        tokenVersion: { increment: 1 },
      },
    });

    res.json({ ok: true });
  }),
);
