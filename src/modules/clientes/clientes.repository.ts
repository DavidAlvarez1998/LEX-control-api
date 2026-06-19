// Acceso a datos del módulo Clientes. ÚNICO lugar con queries Prisma del módulo:
// el `empresaId` se fija al construir el repositorio (scoping multi-tenant forzado;
// un caller no puede olvidarlo). Acepta un client opcional para correr dentro de
// una transacción del servicio.
import { Prisma, type EstadoCliente } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";
import type { PageParams } from "../../shared/pagination";

type ListOpts = { estado?: string; mios?: boolean; usuarioId: string };

const conResponsable = {
  responsableComercial: { select: { id: true, nombre: true } },
} as const;

export class ClientesRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}

  private whereList({ estado, mios, usuarioId }: ListOpts): Prisma.ClienteWhereInput {
    return {
      empresaId: this.empresaId,
      ...(estado ? { estado: estado as EstadoCliente } : {}),
      ...(mios
        ? {
            OR: [
              { responsableComercialId: usuarioId },
              { procesos: { some: { responsableId: usuarioId } } },
            ],
          }
        : {}),
    };
  }

  /** Lista del despacho (orden por ingreso). `mios` = unión responsable comercial ∪ abogado de algún proceso. */
  list(opts: ListOpts) {
    return this.db.cliente.findMany({
      where: this.whereList(opts),
      orderBy: { fechaIngreso: "desc" },
      include: conResponsable,
    });
  }

  /** Variante paginada: total + página (mismo filtro/orden que `list`). */
  listPaginated(opts: ListOpts, p: PageParams) {
    const where = this.whereList(opts);
    return Promise.all([
      this.db.cliente.count({ where }),
      this.db.cliente.findMany({ where, orderBy: { fechaIngreso: "desc" }, include: conResponsable, skip: p.skip, take: p.take }),
    ]);
  }

  /** Un cliente del despacho (con responsable comercial), o null. */
  findById(id: string) {
    return this.db.cliente.findFirst({
      where: { id, empresaId: this.empresaId },
      include: conResponsable,
    });
  }

  /** Cliente crudo (sin include) para la conversión a CLIENTE. */
  findForConvert(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.empresaId } });
  }

  create(data: Omit<Prisma.ClienteUncheckedCreateInput, "empresaId">) {
    return this.db.cliente.create({ data: { ...data, empresaId: this.empresaId } });
  }

  update(id: string, data: Prisma.ClienteUncheckedUpdateInput) {
    return this.db.cliente.update({ where: { id }, data });
  }

  // --- Lookups para validar FK salientes (misma empresa) ---
  usuarioEmpresaId(id: string) {
    return this.db.usuario.findUnique({ where: { id }, select: { empresaId: true } });
  }
  litiganteEmpresaId(id: string) {
    return this.db.litigante.findUnique({ where: { id }, select: { empresaId: true } });
  }
  tipoProcesoEmpresaId(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id }, select: { empresaId: true } });
  }
}
