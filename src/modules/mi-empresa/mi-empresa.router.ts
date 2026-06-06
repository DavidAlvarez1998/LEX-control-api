import { randomBytes } from "crypto";
import { Router } from "express";
import { Prisma, Rol, RolEmpresa } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import {
  requireAuth,
  requireEmpresaAdmin,
  requireRole,
} from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import { generateActivationToken } from "../auth/auth.service";
import { assertSeatAvailable } from "../roles/roles.service";
import {
  ACTIVATION_TTL_MS,
  PUBLIC_SELECT,
  activationUrl,
  deriveEstado,
} from "../usuarios/usuarios.shared";
import {
  createMiembroSchema,
  miembroIdParams,
  updateMiembroSchema,
} from "./mi-empresa.schemas";

export const miEmpresaRoutes: Router = Router();

/**
 * GET /mi-empresa — la empresa del USUARIO logueado, con sus servicios
 * contratados. Endpoint scoped: el usuario nunca elige un id, solo ve lo suyo
 * (la empresa se resuelve por su propio `sub` del token). Restringido a USUARIO;
 * el panel ADMIN usa las rutas `/empresas`.
 */
miEmpresaRoutes.get(
  "/",
  requireAuth,
  requireRole(Rol.USUARIO),
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: {
        empresa: {
          include: {
            servicios: {
              where: { activo: true },
              include: { servicio: true },
              orderBy: { asignadoEn: "desc" },
            },
          },
        },
      },
    });

    if (!usuario?.empresa) {
      throw new HttpError(404, "No tienes una empresa asociada");
    }

    res.json(usuario.empresa);
  }),
);

// --- Equipo de la empresa --------------------------------------------------
// Un administrador de empresa (USUARIO + esAdminEmpresa) gestiona a los usuarios
// de SU PROPIA empresa desde el portal del cliente. La empresa siempre sale del
// token (`req.empresaId`), nunca del body/params, así que es imposible tocar
// otra empresa o crear un ADMIN de plataforma. Reusa el flujo de activación y la
// derivación de estado del módulo `usuarios`.

/** Guardas comunes de todos los endpoints de equipo. */
const equipoGuards = [requireAuth, requireRole(Rol.USUARIO), requireEmpresaAdmin];

/** GET /mi-empresa/usuarios — lista el equipo de la propia empresa con estado. */
miEmpresaRoutes.get(
  "/usuarios",
  ...equipoGuards,
  asyncHandler(async (req, res) => {
    const usuarios = await prisma.usuario.findMany({
      where: { empresaId: req.empresaId! },
      orderBy: { createdAt: "desc" },
      select: { ...PUBLIC_SELECT, activationToken: true },
    });

    res.json(
      usuarios.map(({ activationToken, ...u }) => ({
        ...u,
        estado: deriveEstado({ activo: u.activo, activationToken }),
      })),
    );
  }),
);

/** POST /mi-empresa/usuarios — crea un miembro en la propia empresa y devuelve
 *  el link de activación. Fuerza rol=USUARIO y empresaId del token. */
miEmpresaRoutes.post(
  "/usuarios",
  ...equipoGuards,
  validate({ body: createMiembroSchema }),
  asyncHandler(async (req, res) => {
    const { email, nombre, esAdminEmpresa } = req.body;
    const { raw, hash } = generateActivationToken();
    // La silla que ocupará: admin de empresa ⇒ ADMINISTRADOR, si no JURIDICO.
    const rolEmpresa = esAdminEmpresa
      ? RolEmpresa.ADMINISTRADOR
      : RolEmpresa.JURIDICO;

    try {
      // Una sola transacción: verifica el cupo (puerta de sillas), crea el
      // usuario y le asigna su rol. Si no hay cupo, nada se crea (sin huérfanos).
      const user = await prisma.$transaction(async (tx) => {
        await assertSeatAvailable(tx, req.empresaId!, rolEmpresa);
        const u = await tx.usuario.create({
          data: {
            email,
            nombre,
            empresaId: req.empresaId!, // siempre la empresa del solicitante
            rol: "USUARIO", // un admin de empresa nunca crea ADMIN de plataforma
            esAdminEmpresa: esAdminEmpresa ?? false,
            // placeholder no usable (no es bcrypt): no permite login hasta activar
            password: randomBytes(24).toString("hex"),
            activationToken: hash,
            activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
          },
          select: PUBLIC_SELECT,
        });
        await tx.usuarioRolEmpresa.create({
          data: { usuarioId: u.id, rolEmpresa, empresaId: req.empresaId! },
        });
        return u;
      });
      res.status(201).json({ user, activationUrl: activationUrl(raw, user.rol) });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new HttpError(409, "Ya existe un usuario con ese correo");
      }
      throw err;
    }
  }),
);

/** PATCH /mi-empresa/usuarios/:id — activa/desactiva a un miembro. El filtro por
 *  `empresaId` impide tocar usuarios de otra empresa (404 si no es de la suya).
 *  Desactivar revoca las sesiones vivas (sube tokenVersion). */
miEmpresaRoutes.patch(
  "/usuarios/:id",
  ...equipoGuards,
  validate({ params: miembroIdParams, body: updateMiembroSchema }),
  asyncHandler(async (req, res) => {
    const { activo } = req.body as { activo: boolean };

    // Evita que un admin se desactive a sí mismo y se quede sin acceso.
    if (!activo && req.user!.sub === req.params.id) {
      throw new HttpError(400, "No puedes desactivar tu propia cuenta");
    }

    const { count } = await prisma.usuario.updateMany({
      where: { id: req.params.id, empresaId: req.empresaId! },
      data: activo ? { activo: true } : { activo: false, tokenVersion: { increment: 1 } },
    });
    if (count === 0) throw new HttpError(404, "Usuario no encontrado");

    res.json({ id: req.params.id, activo });
  }),
);

/** POST /mi-empresa/usuarios/:id/activation — regenera el link de activación de
 *  un miembro (reenvío). Revoca su sesión y el enlace anterior. Solo de la propia
 *  empresa. */
miEmpresaRoutes.post(
  "/usuarios/:id/activation",
  ...equipoGuards,
  validate({ params: miembroIdParams }),
  asyncHandler(async (req, res) => {
    const { raw, hash } = generateActivationToken();

    const { count } = await prisma.usuario.updateMany({
      where: { id: req.params.id, empresaId: req.empresaId! },
      data: {
        activationToken: hash,
        activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
        tokenVersion: { increment: 1 },
      },
    });
    if (count === 0) throw new HttpError(404, "Usuario no encontrado");

    // Los miembros del equipo son siempre USUARIO → link al portal del cliente.
    res.json({ activationUrl: activationUrl(raw, "USUARIO") });
  }),
);
