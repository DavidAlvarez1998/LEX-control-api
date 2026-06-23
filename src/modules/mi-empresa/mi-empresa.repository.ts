// Acceso a datos del módulo Mi Empresa (portal del cliente; SCOPED a la empresa del
// solicitante: empresaId forzado al construir). Acepta client opcional para tx.
import { Prisma, type RolEmpresa } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";
import { PUBLIC_SELECT } from "../usuarios/usuarios.shared";

export class MiEmpresaRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}

  /** La empresa del usuario logueado (con servicios solo si es admin de empresa). */
  findEmpresaOfUser(userId: string, conServicios: boolean) {
    const empresaInclude = conServicios
      ? { servicios: { where: { activo: true }, include: { servicio: true }, orderBy: { asignadoEn: "desc" as const } } }
      : {};
    return this.db.usuario.findUnique({
      where: { id: userId },
      select: { empresa: { include: empresaInclude } },
    });
  }

  listTeam() {
    return this.db.usuario.findMany({
      where: { empresaId: this.empresaId },
      orderBy: { createdAt: "desc" },
      select: { ...PUBLIC_SELECT, activationToken: true, rolesEmpresa: { select: { rolEmpresa: true } } },
    });
  }

  countSeatsByRole() {
    return this.db.usuarioRolEmpresa.groupBy({
      by: ["rolEmpresa"],
      where: { empresaId: this.empresaId, usuario: { activo: true } },
      _count: { rolEmpresa: true },
    });
  }

  createMiembro(data: Prisma.UsuarioUncheckedCreateInput) {
    return this.db.usuario.create({ data, select: PUBLIC_SELECT });
  }

  createRolEmpresa(usuarioId: string, rolEmpresa: RolEmpresa, asignadoPorId: string) {
    return this.db.usuarioRolEmpresa.create({
      data: { usuarioId, rolEmpresa, empresaId: this.empresaId, asignadoPorId },
    });
  }

  /** Update scoped por empresa; devuelve filas afectadas (0 = no es de esta empresa). */
  async updateScoped(id: string, data: Prisma.UsuarioUncheckedUpdateManyInput): Promise<number> {
    const { count } = await this.db.usuario.updateMany({ where: { id, empresaId: this.empresaId }, data });
    return count;
  }

  findMiembroScoped(id: string) {
    return this.db.usuario.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true } });
  }

  /** Contacto (email/nombre) scoped por empresa, para el correo de reenvío. */
  findMiembroContacto(id: string) {
    return this.db.usuario.findFirst({
      where: { id, empresaId: this.empresaId },
      select: { email: true, nombre: true, activationToken: true },
    });
  }

  rolesActuales(usuarioId: string) {
    return this.db.usuarioRolEmpresa.findMany({ where: { usuarioId }, select: { rolEmpresa: true } });
  }
  deleteRoles(usuarioId: string, roles: RolEmpresa[]) {
    return this.db.usuarioRolEmpresa.deleteMany({ where: { usuarioId, rolEmpresa: { in: roles } } });
  }
  setEsAdmin(usuarioId: string, esAdminEmpresa: boolean) {
    return this.db.usuario.update({ where: { id: usuarioId }, data: { esAdminEmpresa } });
  }
}
