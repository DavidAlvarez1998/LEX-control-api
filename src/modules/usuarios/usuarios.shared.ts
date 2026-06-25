import type { Rol } from "@prisma/client";
import { env } from "../../config/env";

/** Vigencia del link de activación / reset (48 h). */
export const ACTIVATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Campos públicos del usuario (nunca password ni el hash del token). */
export const PUBLIC_SELECT = {
  id: true,
  email: true,
  nombre: true,
  rol: true,
  activo: true,
  esAdminEmpresa: true,
  empresaId: true,
  porcentajeComision: true,
  cedula: true,
  tarjetaProfesional: true,
  createdAt: true,
} as const;

/** Link de activación al portal que corresponde al rol del usuario: los roles de
 *  plataforma (ADMIN, COMERCIAL) → panel admin; USUARIO → portal del cliente. */
export const activationUrl = (raw: string, rol: Rol): string =>
  `${rol === "USUARIO" ? env.clientUrl : env.adminUrl}/activar?token=${raw}`;

/** Estado derivado de una cuenta a partir de `activo` y el token de activación
 *  pendiente: INACTIVO (deshabilitada) → PENDIENTE (sin contraseña aún) → ACTIVO. */
export const deriveEstado = (u: {
  activo: boolean;
  activationToken: string | null;
}): "ACTIVO" | "PENDIENTE" | "INACTIVO" =>
  !u.activo ? "INACTIVO" : u.activationToken ? "PENDIENTE" : "ACTIVO";
