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
import { resolveEntitlements } from "../entitlements/entitlements.service";
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

/** GET /mi-empresa/usuarios — lista el equipo de la propia empresa con estado y
 *  los roles de empresa que ocupa cada miembro. */
miEmpresaRoutes.get(
  "/usuarios",
  ...equipoGuards,
  asyncHandler(async (req, res) => {
    const usuarios = await prisma.usuario.findMany({
      where: { empresaId: req.empresaId! },
      orderBy: { createdAt: "desc" },
      select: {
        ...PUBLIC_SELECT,
        activationToken: true,
        rolesEmpresa: { select: { rolEmpresa: true } },
      },
    });

    res.json(
      usuarios.map(({ activationToken, rolesEmpresa, ...u }) => ({
        ...u,
        roles: rolesEmpresa.map((r) => r.rolEmpresa),
        estado: deriveEstado({ activo: u.activo, activationToken }),
      })),
    );
  }),
);

/** GET /mi-empresa/cupos — cupo (cap) y sillas usadas por rol según el plan, para
 *  que la UI muestre disponibilidad. cap = null ⇒ ilimitado; 0 ⇒ no incluido en
 *  el plan. `usados` cuenta solo titulares activos (igual que la puerta de cupos). */
miEmpresaRoutes.get(
  "/cupos",
  ...equipoGuards,
  asyncHandler(async (req, res) => {
    const { cuotas } = await resolveEntitlements(req.empresaId!);
    const usados = await prisma.usuarioRolEmpresa.groupBy({
      by: ["rolEmpresa"],
      where: { empresaId: req.empresaId!, usuario: { activo: true } },
      _count: { rolEmpresa: true },
    });
    const usadosPorRol = new Map(
      usados.map((u) => [u.rolEmpresa, u._count.rolEmpresa]),
    );

    res.json(
      (Object.values(RolEmpresa) as RolEmpresa[]).map((rol) => {
        const cap = cuotas.get(rol) ?? 0;
        return {
          rol,
          cap: cap === Infinity ? null : cap,
          usados: usadosPorRol.get(rol) ?? 0,
        };
      }),
    );
  }),
);

/** POST /mi-empresa/usuarios — crea un miembro en la propia empresa y le asigna
 *  uno o más roles de empresa, devolviendo el link de activación. Fuerza
 *  rol=USUARIO y empresaId del token. Incluir ADMINISTRADOR ⇒ esAdminEmpresa. */
miEmpresaRoutes.post(
  "/usuarios",
  ...equipoGuards,
  validate({ body: createMiembroSchema }),
  asyncHandler(async (req, res) => {
    const { email, nombre, roles } = req.body as {
      email: string;
      nombre: string;
      roles: RolEmpresa[];
    };
    const { raw, hash } = generateActivationToken();
    // ADMINISTRADOR es el espejo de esAdminEmpresa (autoridad de gestión de equipo).
    const esAdminEmpresa = roles.includes(RolEmpresa.ADMINISTRADOR);

    try {
      // Una sola transacción: verifica el cupo de CADA rol (puerta de sillas),
      // crea el usuario y asigna todas sus sillas. Si algún rol no tiene cupo,
      // nada se crea (sin usuarios huérfanos ni asignaciones a medias).
      const user = await prisma.$transaction(async (tx) => {
        for (const rolEmpresa of roles) {
          await assertSeatAvailable(tx, req.empresaId!, rolEmpresa);
        }
        const u = await tx.usuario.create({
          data: {
            email,
            nombre,
            empresaId: req.empresaId!, // siempre la empresa del solicitante
            rol: "USUARIO", // un admin de empresa nunca crea ADMIN de plataforma
            esAdminEmpresa,
            // placeholder no usable (no es bcrypt): no permite login hasta activar
            password: randomBytes(24).toString("hex"),
            activationToken: hash,
            activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
          },
          select: PUBLIC_SELECT,
        });
        for (const rolEmpresa of roles) {
          await tx.usuarioRolEmpresa.create({
            data: {
              usuarioId: u.id,
              rolEmpresa,
              empresaId: req.empresaId!,
              asignadoPorId: req.user!.sub,
            },
          });
        }
        return { ...u, roles };
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

/** PATCH /mi-empresa/usuarios/:id — activa/desactiva a un miembro y/o reconcilia
 *  su conjunto de roles de empresa. El filtro por `empresaId` impide tocar
 *  usuarios de otra empresa (404 si no es de la suya). Desactivar revoca las
 *  sesiones vivas (sube tokenVersion). */
miEmpresaRoutes.patch(
  "/usuarios/:id",
  ...equipoGuards,
  validate({ params: miembroIdParams, body: updateMiembroSchema }),
  asyncHandler(async (req, res) => {
    const { activo, roles } = req.body as {
      activo?: boolean;
      roles?: RolEmpresa[];
    };
    const targetId = req.params.id;
    const esYoMismo = req.user!.sub === targetId;

    // Guarda de bloqueo: un admin no puede quedarse sin acceso.
    if (activo === false && esYoMismo) {
      throw new HttpError(400, "No puedes desactivar tu propia cuenta");
    }
    if (roles && esYoMismo && !roles.includes(RolEmpresa.ADMINISTRADOR)) {
      throw new HttpError(400, "No puedes quitarte el rol Administrador");
    }

    // 1) activar/desactivar (igual que antes).
    if (activo !== undefined) {
      const { count } = await prisma.usuario.updateMany({
        where: { id: targetId, empresaId: req.empresaId! },
        data: activo
          ? { activo: true }
          : { activo: false, tokenVersion: { increment: 1 } },
      });
      if (count === 0) throw new HttpError(404, "Usuario no encontrado");
    }

    // 2) reconciliar roles (añade los que faltan, quita los sobrantes) en una
    //    sola transacción con puerta de cupos por cada rol nuevo.
    if (roles) {
      await prisma.$transaction(async (tx) => {
        const target = await tx.usuario.findFirst({
          where: { id: targetId, empresaId: req.empresaId! },
          select: { id: true },
        });
        if (!target) throw new HttpError(404, "Usuario no encontrado");

        const actuales = (
          await tx.usuarioRolEmpresa.findMany({
            where: { usuarioId: targetId },
            select: { rolEmpresa: true },
          })
        ).map((r) => r.rolEmpresa);

        const quitar = actuales.filter((r) => !roles.includes(r));
        const agregar = roles.filter((r) => !actuales.includes(r));

        if (quitar.length) {
          await tx.usuarioRolEmpresa.deleteMany({
            where: { usuarioId: targetId, rolEmpresa: { in: quitar } },
          });
        }
        for (const rolEmpresa of agregar) {
          await assertSeatAvailable(tx, req.empresaId!, rolEmpresa);
          await tx.usuarioRolEmpresa.create({
            data: {
              usuarioId: targetId,
              rolEmpresa,
              empresaId: req.empresaId!,
              asignadoPorId: req.user!.sub,
            },
          });
        }
        // ADMINISTRADOR ⇄ esAdminEmpresa (espejo).
        await tx.usuario.update({
          where: { id: targetId },
          data: { esAdminEmpresa: roles.includes(RolEmpresa.ADMINISTRADOR) },
        });
      });
    }

    res.json({ id: targetId, ...(activo !== undefined && { activo }), ...(roles && { roles }) });
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
