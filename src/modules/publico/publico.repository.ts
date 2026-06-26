// Acceso a datos de los endpoints públicos (landing; sin auth/tenant). Proyección
// MÍNIMA (nada de ids internos/suscripciones/empresa).
import { Prisma, type RolEmpresa } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

export class PublicoRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  listPlanesActivos() {
    return this.db.plan.findMany({
      where: { activo: true },
      orderBy: { orden: "asc" },
      select: {
        clave: true, nombre: true, descripcion: true, precioMensual: true,
        modulos: { select: { modulo: { select: { clave: true } } } },
        cuotas: { select: { rolEmpresa: true, limite: true } },
      },
    });
  }
  findPlanByClave(clave: string) {
    return this.db.plan.findUnique({ where: { clave }, select: { id: true } });
  }
  createProspecto(data: Prisma.ProspectoUncheckedCreateInput) {
    return this.db.prospecto.create({ data });
  }

  // --- Alta autoservicio (cuenta-autoservicio-empresa) -----------------------
  // Verifican duplicados ANTES de la tx para devolver un 409 claro (el @unique de
  // email/rfc es el seguro real; esto da el mensaje amable).
  findUsuarioByEmail(email: string) {
    return this.db.usuario.findUnique({ where: { email }, select: { id: true } });
  }
  findEmpresaByRfc(rfc: string) {
    return this.db.empresa.findUnique({ where: { rfc }, select: { id: true } });
  }
  createEmpresa(data: Prisma.EmpresaUncheckedCreateInput) {
    return this.db.empresa.create({ data });
  }
  createSuscripcion(empresaId: string, planId: string) {
    return this.db.suscripcion.create({ data: { empresaId, planId, estado: "ACTIVA" } });
  }
  createUsuario(data: Prisma.UsuarioUncheckedCreateInput) {
    return this.db.usuario.create({ data });
  }
  createRolEmpresa(usuarioId: string, rolEmpresa: RolEmpresa, empresaId: string) {
    return this.db.usuarioRolEmpresa.create({ data: { usuarioId, rolEmpresa, empresaId } });
  }
}
