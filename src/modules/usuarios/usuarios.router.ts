import { randomBytes } from "crypto";
import { Router } from "express";
import { Prisma, Rol, RolEmpresa } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth, requireRole } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import { generateActivationToken } from "../auth/auth.service";
import { assertSeatAvailable, assignRole, removeRole } from "../roles/roles.service";
import {
  ACTIVATION_TTL_MS,
  PUBLIC_SELECT,
  activationUrl,
  deriveEstado,
} from "./usuarios.shared";
import {
  createUsuarioSchema,
  updateUsuarioSchema,
  usuarioIdParams,
} from "./usuarios.schemas";

export const usuarioRoutes: Router = Router();

/** GET /usuarios — lista usuarios (opcional ?empresaId), con estado derivado. */
usuarioRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  asyncHandler(async (req, res) => {
    const empresaId =
      typeof req.query.empresaId === "string" ? req.query.empresaId : undefined;

    const usuarios = await prisma.usuario.findMany({
      where: empresaId ? { empresaId } : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        ...PUBLIC_SELECT,
        activationToken: true, // solo para derivar el estado; no se devuelve
        empresa: { select: { nombre: true } },
      },
    });

    res.json(
      usuarios.map(({ activationToken, ...u }) => ({
        ...u,
        estado: deriveEstado({ activo: u.activo, activationToken }),
      })),
    );
  }),
);

/** POST /usuarios — crea el usuario y devuelve el link de activación. */
usuarioRoutes.post(
  "/",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ body: createUsuarioSchema }),
  asyncHandler(async (req, res) => {
    const { email, nombre, empresaId, rol, esAdminEmpresa, porcentajeComision } = req.body;
    const finalRol: Rol = rol ?? "USUARIO";
    const { raw, hash } = generateActivationToken();

    const data = {
      email,
      nombre,
      empresaId,
      rol: finalRol,
      esAdminEmpresa: esAdminEmpresa ?? false,
      // % de comisión solo aplica al vendedor de plataforma.
      porcentajeComision: finalRol === "COMERCIAL" ? (porcentajeComision ?? 0) : null,
      // placeholder no usable (no es bcrypt): no permite login hasta activar
      password: randomBytes(24).toString("hex"),
      activationToken: hash,
      activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
    };

    try {
      // Un USUARIO de empresa ocupa una silla (ADMINISTRADOR si esAdminEmpresa,
      // si no JURIDICO): crear + verificar cupo + asignar rol en una transacción.
      // Un ADMIN de plataforma (sin empresa) no consume silla.
      const user = await prisma.$transaction(async (tx) => {
        if (finalRol === "USUARIO" && empresaId) {
          const rolEmpresa = esAdminEmpresa
            ? RolEmpresa.ADMINISTRADOR
            : RolEmpresa.JURIDICO;
          await assertSeatAvailable(tx, empresaId, rolEmpresa);
          const u = await tx.usuario.create({ data, select: PUBLIC_SELECT });
          await tx.usuarioRolEmpresa.create({
            data: { usuarioId: u.id, rolEmpresa, empresaId },
          });
          return u;
        }
        return tx.usuario.create({ data, select: PUBLIC_SELECT });
      });
      res.status(201).json({ user, activationUrl: activationUrl(raw, user.rol) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002")
          throw new HttpError(409, "Ya existe un usuario con ese correo");
        if (err.code === "P2003")
          throw new HttpError(400, "La empresa indicada no existe");
      }
      throw err;
    }
  }),
);

/** PATCH /usuarios/:id — actualiza nombre, rol, activo, esAdminEmpresa. */
usuarioRoutes.patch(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: usuarioIdParams, body: updateUsuarioSchema }),
  asyncHandler(async (req, res) => {
    // Si cambia esAdminEmpresa, sincroniza el rol ADMINISTRADOR ANTES del update.
    // La silla manda: si no hay cupo al promover, 409 y el update no se aplica
    // (sin drift flag↔rol). assignRole/removeRole ya ponen esAdminEmpresa en sync.
    if (typeof req.body.esAdminEmpresa === "boolean") {
      const actual = await prisma.usuario.findUnique({
        where: { id: req.params.id },
        select: { empresaId: true },
      });
      if (actual?.empresaId) {
        if (req.body.esAdminEmpresa) {
          await assignRole({
            usuarioId: req.params.id,
            rolEmpresa: RolEmpresa.ADMINISTRADOR,
            empresaId: actual.empresaId,
          });
        } else {
          await removeRole({
            usuarioId: req.params.id,
            rolEmpresa: RolEmpresa.ADMINISTRADOR,
          });
        }
      }
    }
    try {
      // Desactivar revoca las sesiones vivas: sube tokenVersion para que los
      // JWT ya emitidos dejen de validar (ver change `auth-session-revocation`).
      const data =
        req.body.activo === false
          ? { ...req.body, tokenVersion: { increment: 1 } }
          : req.body;
      const user = await prisma.usuario.update({
        where: { id: req.params.id },
        data,
        select: PUBLIC_SELECT,
      });
      res.json(user);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new HttpError(404, "Usuario no encontrado");
      }
      throw err;
    }
  }),
);

/** POST /usuarios/:id/reset-password — regenera el link de activación. */
usuarioRoutes.post(
  "/:id/reset-password",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: usuarioIdParams }),
  asyncHandler(async (req, res) => {
    const { raw, hash } = generateActivationToken();
    try {
      const usuario = await prisma.usuario.update({
        where: { id: req.params.id },
        data: {
          activationToken: hash,
          activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
          // Revoca al instante las sesiones vivas del usuario reseteado.
          tokenVersion: { increment: 1 },
        },
        select: { rol: true },
      });
      res.json({ activationUrl: activationUrl(raw, usuario.rol) });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new HttpError(404, "Usuario no encontrado");
      }
      throw err;
    }
  }),
);

/** DELETE /usuarios/:id — elimina el usuario de forma permanente (hard delete). */
usuarioRoutes.delete(
  "/:id",
  requireAuth,
  requireRole(Rol.ADMIN),
  validate({ params: usuarioIdParams }),
  asyncHandler(async (req, res) => {
    // Un admin no puede borrarse a sí mismo (evita quedarse sin acceso).
    if (req.user?.sub === req.params.id) {
      throw new HttpError(400, "No puedes eliminar tu propia cuenta");
    }
    try {
      await prisma.usuario.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new HttpError(404, "Usuario no encontrado");
      }
      throw err;
    }
  }),
);
