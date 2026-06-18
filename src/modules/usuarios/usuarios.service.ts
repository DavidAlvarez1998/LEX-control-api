// Casos de uso de Usuarios (plataforma). Alta con cupo (silla) + rol de empresa en
// transacción; activación/reset con link; sincronización de ADMINISTRADOR al togglear
// esAdminEmpresa; revocación de sesión al desactivar/resetear. Sin Express.
import { randomBytes } from "crypto";
import { Prisma, type Rol, RolEmpresa } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { generateActivationToken } from "../auth/auth.service";
import { assertSeatAvailable, assignRole, removeRole } from "../roles/roles.service";
import { ACTIVATION_TTL_MS, activationUrl } from "./usuarios.shared";
import { UsuariosRepository } from "./usuarios.repository";
import type { CreateUsuarioInput, UpdateUsuarioInput } from "./usuarios.schemas";

export function listUsuarios(empresaId?: string) {
  return new UsuariosRepository().listWithEstado(empresaId);
}

export async function createUsuario(input: CreateUsuarioInput) {
  const { email, nombre, empresaId, rol, esAdminEmpresa, porcentajeComision } = input;
  const finalRol: Rol = rol ?? "USUARIO";
  const { raw, hash } = generateActivationToken();

  const data = {
    email,
    nombre,
    empresaId,
    rol: finalRol,
    esAdminEmpresa: esAdminEmpresa ?? false,
    porcentajeComision: finalRol === "COMERCIAL" ? (porcentajeComision ?? 0) : null,
    password: randomBytes(24).toString("hex"), // placeholder no usable hasta activar
    activationToken: hash,
    activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
  };

  try {
    const user = await prisma.$transaction(async (tx) => {
      const r = new UsuariosRepository(tx);
      // Un USUARIO de empresa ocupa una silla (ADMINISTRADOR/JURIDICO): verifica cupo
      // y asigna el rol dentro de la misma transacción. El ADMIN de plataforma no.
      if (finalRol === "USUARIO" && empresaId) {
        const rolEmpresa = esAdminEmpresa ? RolEmpresa.ADMINISTRADOR : RolEmpresa.JURIDICO;
        await assertSeatAvailable(tx, empresaId, rolEmpresa);
        const u = await r.create(data);
        await r.createRolEmpresa(u.id, rolEmpresa, empresaId);
        return u;
      }
      return r.create(data);
    });
    return { user, activationUrl: activationUrl(raw, user.rol) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") throw new HttpError(409, "Ya existe un usuario con ese correo");
      if (err.code === "P2003") throw new HttpError(400, "La empresa indicada no existe");
    }
    throw err;
  }
}

export async function updateUsuario(id: string, input: UpdateUsuarioInput) {
  // Sincroniza el rol ADMINISTRADOR ANTES del update (la silla manda: si no hay
  // cupo al promover, 409 y el update no se aplica → sin drift flag↔rol).
  if (typeof input.esAdminEmpresa === "boolean") {
    const actual = await new UsuariosRepository().findEmpresaId(id);
    if (actual?.empresaId) {
      if (input.esAdminEmpresa) {
        await assignRole({ usuarioId: id, rolEmpresa: RolEmpresa.ADMINISTRADOR, empresaId: actual.empresaId });
      } else {
        await removeRole({ usuarioId: id, rolEmpresa: RolEmpresa.ADMINISTRADOR });
      }
    }
  }
  try {
    // Desactivar revoca las sesiones vivas (sube tokenVersion).
    const data = input.activo === false ? { ...input, tokenVersion: { increment: 1 } } : input;
    return await new UsuariosRepository().update(id, data);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new HttpError(404, "Usuario no encontrado");
    }
    throw err;
  }
}

export async function resetPassword(id: string) {
  const { raw, hash } = generateActivationToken();
  try {
    const usuario = await new UsuariosRepository().updateForReset(id, {
      activationToken: hash,
      activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
      tokenVersion: { increment: 1 },
    });
    return { activationUrl: activationUrl(raw, usuario.rol) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new HttpError(404, "Usuario no encontrado");
    }
    throw err;
  }
}

export async function deleteUsuario(id: string, requesterId: string | undefined): Promise<void> {
  if (requesterId === id) throw new HttpError(400, "No puedes eliminar tu propia cuenta");
  try {
    await new UsuariosRepository().delete(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new HttpError(404, "Usuario no encontrado");
    }
    throw err;
  }
}
