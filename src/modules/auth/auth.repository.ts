// Acceso a datos de Auth (plataforma; login por email, sin tenant).
import { prisma, type PrismaLike } from "../../shared/prisma";

const userInclude = {
  empresa: { select: { nombre: true, activo: true } },
  rolesEmpresa: { select: { rolEmpresa: true } },
} as const;

export class AuthRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  findByEmail(email: string) {
    return this.db.usuario.findUnique({ where: { email }, include: userInclude });
  }
  findById(id: string) {
    return this.db.usuario.findUnique({ where: { id }, include: userInclude });
  }
  findByActivationToken(hash: string) {
    return this.db.usuario.findUnique({ where: { activationToken: hash } });
  }
  activate(id: string, data: Record<string, unknown>) {
    return this.db.usuario.update({ where: { id }, data: data as never });
  }
}
