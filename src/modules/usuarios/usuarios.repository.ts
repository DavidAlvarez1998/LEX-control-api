// Acceso a datos de Usuarios (gestión ADMIN de plataforma). Acepta client opcional
// para correr dentro de la transacción del servicio (alta con cupo + rol de empresa).
import type { RolEmpresa } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";
import { PUBLIC_SELECT } from "./usuarios.shared";

export class UsuariosRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  /** Lista (opcional por empresa) con activationToken para derivar el estado. */
  listWithEstado(empresaId?: string) {
    return this.db.usuario.findMany({
      where: empresaId ? { empresaId } : undefined,
      orderBy: { createdAt: "desc" },
      select: { ...PUBLIC_SELECT, activationToken: true, empresa: { select: { nombre: true } } },
    });
  }

  create(data: Record<string, unknown>) {
    return this.db.usuario.create({ data: data as never, select: PUBLIC_SELECT });
  }

  createRolEmpresa(usuarioId: string, rolEmpresa: RolEmpresa, empresaId: string) {
    return this.db.usuarioRolEmpresa.create({ data: { usuarioId, rolEmpresa, empresaId } });
  }

  findEmpresaId(id: string) {
    return this.db.usuario.findUnique({ where: { id }, select: { empresaId: true } });
  }

  /** Update devolviendo los campos públicos (PATCH). */
  update(id: string, data: Record<string, unknown>) {
    return this.db.usuario.update({ where: { id }, data: data as never, select: PUBLIC_SELECT });
  }

  /** Update devolviendo solo el rol (reset-password: arma la URL de activación). */
  updateForReset(id: string, data: Record<string, unknown>) {
    return this.db.usuario.update({ where: { id }, data: data as never, select: { rol: true } });
  }

  delete(id: string) {
    return this.db.usuario.delete({ where: { id } });
  }
}
