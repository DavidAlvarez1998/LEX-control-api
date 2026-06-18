// Acceso a datos del módulo Clientes. ÚNICO lugar con queries Prisma del módulo:
// el `empresaId` se fija al construir el repositorio (scoping multi-tenant forzado;
// un caller no puede olvidarlo). Acepta un client opcional para correr dentro de
// una transacción del servicio.
import { Prisma, type EstadoCliente } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

type ListOpts = { estado?: string; mios?: boolean; usuarioId: string };

const conResponsable = {
  responsableComercial: { select: { id: true, nombre: true } },
} as const;

export class ClientesRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}

  /** Lista del despacho (orden por ingreso). `mios` = unión responsable comercial ∪ abogado de algún proceso. */
  list({ estado, mios, usuarioId }: ListOpts) {
    return this.db.cliente.findMany({
      where: {
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
      },
      orderBy: { fechaIngreso: "desc" },
      include: conResponsable,
    });
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
