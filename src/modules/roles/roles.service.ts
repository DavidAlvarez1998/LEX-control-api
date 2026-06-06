// Servicio de roles de empresa: asignar/quitar un RolEmpresa con puerta de cupos
// transaccional, manteniendo `esAdminEmpresa` en sync con ADMINISTRADOR.
// Ver openspec/changes/foundations-roles-plans-clientes/.
import { Prisma, RolEmpresa } from "@prisma/client";
import { prisma } from "../../index";
import { HttpError } from "../../middleware/error";
import { resolveEntitlements } from "../entitlements/entitlements.service";

/**
 * Verifica que haya cupo para una silla `(empresaId, rolEmpresa)` ANTES de
 * crearla, dentro de una transacción. Bloquea la fila `suscripciones` de la
 * empresa con `FOR UPDATE` (fila padre ESTABLE: existe aunque el rol tenga 0
 * sillas todavía, evitando la carrera de "primer titular"). El cupo cuenta solo
 * titulares con `usuario.activo = true` (al desactivar se libera la silla).
 * Lanza 409 si no hay cupo.
 */
export async function assertSeatAvailable(
  tx: Prisma.TransactionClient,
  empresaId: string,
  rolEmpresa: RolEmpresa,
): Promise<void> {
  // Lock de la fila padre estable (serializa asignaciones concurrentes).
  await tx.$queryRaw`SELECT id FROM suscripciones WHERE empresaId = ${empresaId} FOR UPDATE`;

  const { cuotas } = await resolveEntitlements(empresaId);
  const cap = cuotas.get(rolEmpresa) ?? 0;
  if (cap === Infinity) return; // ilimitado

  const usadas = await tx.usuarioRolEmpresa.count({
    where: { empresaId, rolEmpresa, usuario: { activo: true } },
  });
  if (usadas >= cap) {
    throw new HttpError(
      409,
      `Sin cupo para el rol ${rolEmpresa} en el plan actual (límite ${cap}).`,
    );
  }
}

/**
 * Asigna un rol a un usuario (idempotente), con puerta de cupos. Si el rol es
 * ADMINISTRADOR sincroniza `esAdminEmpresa = true` (espejo; esAdminEmpresa sigue
 * siendo la autoridad de gestión de equipo).
 */
export async function assignRole(opts: {
  usuarioId: string;
  rolEmpresa: RolEmpresa;
  empresaId: string;
  asignadoPorId?: string | null;
}): Promise<void> {
  const { usuarioId, rolEmpresa, empresaId, asignadoPorId } = opts;
  await prisma.$transaction(async (tx) => {
    const ya = await tx.usuarioRolEmpresa.findUnique({
      where: { usuarioId_rolEmpresa: { usuarioId, rolEmpresa } },
    });
    if (ya) return; // idempotente: ya tiene el rol

    await assertSeatAvailable(tx, empresaId, rolEmpresa);
    await tx.usuarioRolEmpresa.create({
      data: { usuarioId, rolEmpresa, empresaId, asignadoPorId: asignadoPorId ?? null },
    });
    if (rolEmpresa === RolEmpresa.ADMINISTRADOR) {
      await tx.usuario.update({ where: { id: usuarioId }, data: { esAdminEmpresa: true } });
    }
  });
}

/**
 * Quita un rol a un usuario (idempotente). Si es ADMINISTRADOR sincroniza
 * `esAdminEmpresa = false`.
 */
export async function removeRole(opts: {
  usuarioId: string;
  rolEmpresa: RolEmpresa;
}): Promise<void> {
  const { usuarioId, rolEmpresa } = opts;
  await prisma.$transaction(async (tx) => {
    await tx.usuarioRolEmpresa.deleteMany({ where: { usuarioId, rolEmpresa } });
    if (rolEmpresa === RolEmpresa.ADMINISTRADOR) {
      await tx.usuario.update({ where: { id: usuarioId }, data: { esAdminEmpresa: false } });
    }
  });
}
