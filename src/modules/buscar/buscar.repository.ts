// Acceso a datos de la búsqueda global: una query acotada (take) por entidad.
// El service decide CUÁLES ejecutar según rol/permiso; aquí solo viven las queries.
import { prisma, type PrismaLike } from "../../shared/prisma";

const TAKE = 5;

export class BuscarRepository {
  constructor(private readonly db: PrismaLike = prisma) {}

  prospectos(q: string, comercialId?: string) {
    return this.db.prospecto.findMany({
      where: {
        ...(comercialId ? { comercialId } : {}),
        OR: [
          { nombreEmpresa: { contains: q } },
          { nombreContacto: { contains: q } },
          { numeroDocumento: { contains: q } },
          { telefono: { contains: q } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, nombreEmpresa: true, nombreContacto: true },
    });
  }

  empresas(q: string) {
    return this.db.empresa.findMany({
      where: { OR: [{ nombre: { contains: q } }, { rfc: { contains: q } }, { email: { contains: q } }] },
      orderBy: { nombre: "asc" },
      take: TAKE,
      select: { id: true, nombre: true, rfc: true },
    });
  }

  planes(q: string) {
    return this.db.plan.findMany({
      where: { OR: [{ nombre: { contains: q } }, { clave: { contains: q } }] },
      orderBy: { orden: "asc" },
      take: TAKE,
      select: { id: true, nombre: true, clave: true },
    });
  }

  usuariosPlataforma(q: string) {
    return this.db.usuario.findMany({
      where: { OR: [{ nombre: { contains: q } }, { email: { contains: q } }] },
      orderBy: { nombre: "asc" },
      take: TAKE,
      select: { id: true, nombre: true, email: true },
    });
  }

  clientes(empresaId: string, q: string) {
    return this.db.cliente.findMany({
      where: {
        empresaId,
        OR: [
          { nombre: { contains: q } },
          { numeroDocumento: { contains: q } },
          { telefono: { contains: q } },
          { email: { contains: q } },
        ],
      },
      orderBy: { fechaIngreso: "desc" },
      take: TAKE,
      select: { id: true, nombre: true, numeroDocumento: true },
    });
  }

  procesos(empresaId: string, q: string) {
    return this.db.proceso.findMany({
      where: {
        empresaId,
        OR: [{ codigoInterno: { contains: q } }, { radicado: { contains: q } }, { titulo: { contains: q } }],
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, titulo: true, codigoInterno: true },
    });
  }

  facturas(empresaId: string, q: string) {
    return this.db.factura.findMany({
      where: { empresaId, OR: [{ numero: { contains: q } }, { radicado: { contains: q } }] },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, numero: true, cliente: { select: { nombre: true } } },
    });
  }

  equipo(empresaId: string, q: string) {
    return this.db.usuario.findMany({
      where: { empresaId, OR: [{ nombre: { contains: q } }, { email: { contains: q } }] },
      orderBy: { nombre: "asc" },
      take: TAKE,
      select: { id: true, nombre: true, email: true },
    });
  }

  contratos(empresaId: string, q: string) {
    return this.db.contrato.findMany({
      where: {
        empresaId,
        OR: [{ nombreCompleto: { contains: q } }, { numeroDocumento: { contains: q } }, { cargo: { contains: q } }],
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, nombreCompleto: true, cargo: true },
    });
  }
}
