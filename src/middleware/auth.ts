import type { NextFunction, Request, Response } from "express";
import type { Rol } from "@prisma/client";
import { HttpError } from "./error";
import { type JwtPayload, verifyToken } from "../modules/auth/auth.service";

// Agrega el usuario autenticado al Request de Express.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Requiere un JWT válido en `Authorization: Bearer <token>`. */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "No autenticado");
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    req.user = verifyToken(token);
  } catch {
    throw new HttpError(401, "Token inválido o expirado");
  }
  next();
}

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
