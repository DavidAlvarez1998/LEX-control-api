import type { NextFunction, Request, Response } from "express";
import type { Rol, RolEmpresa } from "@prisma/client";
import { prisma } from "../index";
import { HttpError } from "./error";
import { asyncHandler } from "./async";
import { type JwtPayload, verifyToken } from "../modules/auth/auth.service";
import { resolveEntitlements, type Entitlements } from "../modules/entitlements/entitlements.service";

// Agrega el usuario autenticado al Request de Express. El JWT solo lleva
// { sub, rol, tv }: la empresa, el flag esAdminEmpresa y los roles de empresa se
// resuelven por BD en cada request (el token NO transporta empresaId).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      empresaId?: string | null;
      esAdminEmpresa?: boolean;
      rolesEmpresa?: RolEmpresa[];
    }
  }
}

/**
 * Requiere un JWT válido en `Authorization: Bearer <token>` Y que el usuario siga
 * habilitado en BD. Además de la firma/expiración del token, comprueba el estado
 * actual de la cuenta: el usuario existe, está `activo`, no está pendiente de
 * activación, y la versión del token (`tv`) coincide con `tokenVersion`. Así un
 * reset/desactivación revoca al instante los tokens ya emitidos (ver change
 * `auth-session-revocation`).
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "No autenticado");
  }

  const token = header.slice("Bearer ".length).trim();
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new HttpError(401, "Token inválido o expirado");
  }

  const user = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: {
      activo: true,
      activationToken: true,
      tokenVersion: true,
      empresaId: true,
      esAdminEmpresa: true,
      empresa: { select: { activo: true } },
      rolesEmpresa: { select: { rolEmpresa: true } },
    },
  });

  // Mismo mensaje genérico para no distinguir token corrupto de cuenta revocada.
  if (
    !user ||
    !user.activo ||
    user.activationToken !== null || // pendiente: reset emitido o sin activar
    (payload.tv ?? 0) !== user.tokenVersion || // token de una versión ya revocada
    (user.empresa && !user.empresa.activo) // empresa desactivada → revoca a todos sus usuarios
  ) {
    throw new HttpError(401, "Token inválido o expirado");
  }

  req.user = payload;
  req.empresaId = user.empresaId; // null para ADMIN de plataforma
  req.esAdminEmpresa = user.esAdminEmpresa;
  // Defensivo (`?? []`): tokens/mocks sin la relación no rompen la resolución.
  req.rolesEmpresa = (user.rolesEmpresa ?? []).map((r) => r.rolEmpresa);
  next();
});

/** Requiere que el usuario autenticado tenga uno de los roles indicados. */
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    if (!roles.includes(req.user.rol)) {
      throw new HttpError(403, "No autorizado");
    }
    next();
  };
}

/**
 * Requiere un USUARIO de empresa con `esAdminEmpresa = true`. Hasta ahora ese
 * flag se almacenaba pero nunca se aplicaba; este middleware lo hace exigible
 * (gestiona el catálogo propio del despacho). Debe ir DESPUÉS de `requireAuth`.
 */
export function requireEmpresaAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) throw new HttpError(401, "No autenticado");
  if (!req.empresaId || !req.esAdminEmpresa) {
    throw new HttpError(403, "Requiere ser administrador de la empresa");
  }
  next();
}

/**
 * Resuelve el `empresaId` del USUARIO autenticado o lanza 400 si no tiene
 * empresa (p. ej. un ADMIN de plataforma usando un endpoint de despacho).
 */
export function empresaIdRequerido(req: Request): string {
  if (!req.empresaId) {
    throw new HttpError(400, "El usuario no pertenece a una empresa");
  }
  return req.empresaId;
}

/**
 * Exige un permiso `clave` (p. ej. "cliente.crear") sobre la empresa del token.
 * Dos puertas: (1) MÓDULO — el módulo dueño del permiso debe estar contratado
 * (resolveEntitlements); (2) RBAC — algún RolEmpresa del usuario concede el
 * permiso. `esAdminEmpresa` corta solo la puerta RBAC (sigue sujeto a la de
 * módulo). El `empresaId` SIEMPRE sale del token (nunca del cliente). Debe ir
 * DESPUÉS de `requireAuth`.
 */
// Memo por-request de los entitlements: una sola request puede cruzar varias puertas
// (p. ej. la búsqueda global corre ~5 `tienePermiso`), y cada `resolveEntitlements`
// son 2 queries de datos casi estáticos. Cacheamos la promesa por objeto `req` (el
// empresaId es fijo por request, viene del token) → de ~5×2 queries de auth a 2.
const entitlementsPorReq = new WeakMap<Request, Promise<Entitlements>>();
function entitlementsDeReq(req: Request, empresaId: string): Promise<Entitlements> {
  let p = entitlementsPorReq.get(req);
  if (!p) {
    p = resolveEntitlements(empresaId);
    entitlementsPorReq.set(req, p);
  }
  return p;
}

export function requirePermiso(clave: string) {
  return asyncHandler(async (req, _res, next) => {
    const empresaId = empresaIdRequerido(req);

    const permiso = await prisma.permiso.findUnique({
      where: { clave },
      select: {
        modulo: { select: { clave: true } },
        roles: { select: { rolEmpresa: true } },
      },
    });
    if (!permiso) {
      // Mala configuración (permiso no sembrado): 500, no se expone al flujo normal.
      throw new HttpError(500, `Permiso no configurado: ${clave}`);
    }

    // Puerta de módulo.
    const { modulosHabilitados } = await entitlementsDeReq(req, empresaId);
    if (!modulosHabilitados.has(permiso.modulo.clave)) {
      throw new HttpError(403, "Módulo no contratado");
    }

    // Puerta RBAC (esAdminEmpresa la corta).
    if (req.esAdminEmpresa) return next();
    const concedidos = new Set(permiso.roles.map((r) => r.rolEmpresa));
    const tiene = (req.rolesEmpresa ?? []).some((r) => concedidos.has(r));
    if (!tiene) throw new HttpError(403, "No autorizado");
    next();
  });
}

/**
 * Versión NO-lanzadora de `requirePermiso`: responde `true/false` en vez de tirar
 * 403/500. Aplica las dos mismas puertas (módulo contratado + RBAC, con
 * `esAdminEmpresa` cortando la RBAC). Útil cuando un endpoint decide qué incluir
 * según el permiso sin abortar toda la request (p. ej. la búsqueda global, que
 * consulta una entidad solo si el usuario puede verla). Debe ir tras `requireAuth`.
 */
export async function tienePermiso(req: Request, clave: string): Promise<boolean> {
  if (!req.empresaId) return false;
  const permiso = await prisma.permiso.findUnique({
    where: { clave },
    select: {
      modulo: { select: { clave: true } },
      roles: { select: { rolEmpresa: true } },
    },
  });
  if (!permiso) return false; // permiso no sembrado → trátalo como sin acceso
  const { modulosHabilitados } = await entitlementsDeReq(req, req.empresaId);
  if (!modulosHabilitados.has(permiso.modulo.clave)) return false;
  if (req.esAdminEmpresa) return true;
  const concedidos = new Set(permiso.roles.map((r) => r.rolEmpresa));
  return (req.rolesEmpresa ?? []).some((r) => concedidos.has(r));
}
