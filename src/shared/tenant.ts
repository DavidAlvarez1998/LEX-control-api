// Contexto de tenant + usuario que se inyecta a servicios/repositorios. Se resuelve
// UNA vez por request (en `requireAuth`, que ya carga empresaId/roles) y se lee con
// `tenant(req)`. Lo que se inyecta es ESTE contexto, NO una instancia de Prisma.
import type { Request } from "express";
import type { RolEmpresa } from "@prisma/client";
import { HttpError } from "../middleware/error";

export type TenantContext = {
  userId: string;
  /** null = ADMIN de plataforma (sin empresa). */
  empresaId: string | null;
  esAdminEmpresa: boolean;
  rolesEmpresa: RolEmpresa[];
};

/** Construye el TenantContext desde el Request ya autenticado (post requireAuth). */
export function tenant(req: Request): TenantContext {
  return {
    userId: req.user!.sub,
    empresaId: req.empresaId ?? null,
    esAdminEmpresa: req.esAdminEmpresa ?? false,
    rolesEmpresa: req.rolesEmpresa ?? [],
  };
}

/** Devuelve el empresaId o lanza 400 (equivalente a `empresaIdRequerido`, para servicios). */
export function empresaIdOrThrow(t: TenantContext): string {
  if (!t.empresaId) throw new HttpError(400, "Esta acción requiere una empresa asociada");
  return t.empresaId;
}
