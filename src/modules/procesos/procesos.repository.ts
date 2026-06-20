// Acceso a datos del módulo Procesos (el más grande). Tenant-scoped (empresaId
// forzado al construir). Acepta client opcional para las transacciones del servicio
// (crear, mover etapa, derivar). El motor de etapas es PURO (maquina-etapas.ts).
import { Prisma } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

export const detalleInclude = {
  tipoProceso: { include: { areas: { include: { area: true } } } },
  partes: { include: { litigante: true } },
  historial: { orderBy: { createdAt: "asc" } },
  responsable: { select: { id: true, nombre: true } },
  cliente: { select: { id: true, nombre: true, estado: true } },
  documentos: { orderBy: { createdAt: "desc" } },
} as const;

const listInclude = {
  tipoProceso: { include: { areas: { include: { area: true } } } },
  responsable: { select: { id: true, nombre: true } },
  cliente: { select: { nombre: true } },
  _count: { select: { derivados: true } },
} as const;

const casoSelect = {
  id: true, codigoInterno: true, radicado: true, datos: true, titulo: true,
  estado: true, etapaActual: true, fechaLimite: true, casoRelacionadoId: true, createdAt: true,
  tipoProceso: { select: { nombre: true, esJudicial: true, grupo: true, etapas: true } },
} as const;

export class ProcesosRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}
  private get e() {
    return this.empresaId;
  }

  // --- listado ---
  countAndList(where: Prisma.ProcesoWhereInput, skip: number, take: number) {
    const scoped = { ...where, empresaId: this.e };
    return Promise.all([
      this.db.proceso.count({ where: scoped }),
      this.db.proceso.findMany({ where: scoped, include: listInclude, orderBy: { updatedAt: "desc" }, skip, take }),
    ]);
  }
  listVencimientos(extra: Prisma.ProcesoWhereInput) {
    return this.db.proceso.findMany({
      where: { empresaId: this.e, estado: { notIn: ["CERRADO", "ARCHIVADO"] }, ...extra },
      select: { id: true, codigoInterno: true, radicado: true, titulo: true, etapaActual: true, estado: true, fechaLimite: true },
      orderBy: { fechaLimite: { sort: "asc", nulls: "last" } },
    });
  }

  // --- caso (cadena) ---
  findCaso(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, select: casoSelect });
  }
  findCasoHijos(parentId: string) {
    return this.db.proceso.findMany({ where: { empresaId: this.e, casoRelacionadoId: parentId }, select: casoSelect, orderBy: { createdAt: "asc" } });
  }

  // --- detalle ---
  findDetalle(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, include: detalleInclude });
  }
  findDetalleById(id: string) {
    return this.db.proceso.findUnique({ where: { id }, include: detalleInclude });
  }

  // --- tipos / fk lookups ---
  findTipo(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id } });
  }
  findTipoCalcular(id: string) {
    return this.db.tipoProceso.findUnique({ where: { id }, select: { empresaId: true, etapas: true } });
  }
  findTipoGlobalPorNombre(nombre: string) {
    return this.db.tipoProceso.findFirst({ where: { empresaId: null, nombre } });
  }
  findUsuarioScoped(id: string) {
    return this.db.usuario.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  findProcesoScopedId(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }

  // --- crear ---
  findClienteScoped(id: string) {
    return this.db.cliente.findFirst({ where: { id, empresaId: this.e } });
  }
  createCliente(data: Omit<Prisma.ClienteUncheckedCreateInput, "empresaId">) {
    return this.db.cliente.create({ data: { ...data, empresaId: this.e } });
  }
  findLitiganteScoped(id: string) {
    return this.db.litigante.findFirst({ where: { id, empresaId: this.e }, select: { id: true } });
  }
  createLitigante(data: Omit<Prisma.LitiganteUncheckedCreateInput, "empresaId">) {
    return this.db.litigante.create({ data: { ...data, empresaId: this.e } });
  }
  createProceso(data: Prisma.ProcesoUncheckedCreateInput) {
    return this.db.proceso.create({ data });
  }
  createParte(data: Prisma.ParteProcesoUncheckedCreateInput) {
    return this.db.parteProceso.create({ data });
  }

  // --- mover etapa / derivar / autoavance ---
  findParaEtapa(id: string) {
    return this.db.proceso.findFirst({
      where: { id, empresaId: this.e },
      include: { tipoProceso: { select: { etapas: true } }, documentos: { select: { nombre: true } } },
    });
  }
  findParaDerivar(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, include: { tipoProceso: { select: { etapas: true } } } });
  }
  findDerivadoExistente(baseId: string, tipoProcesoId: string) {
    return this.db.proceso.findFirst({ where: { empresaId: this.e, casoRelacionadoId: baseId, tipoProcesoId }, select: { id: true, codigoInterno: true } });
  }
  findParaAutoavance(id: string) {
    return this.db.proceso.findFirst({
      where: { id, empresaId: this.e },
      select: { id: true, etapaActual: true, datos: true, estado: true, tipoProceso: { select: { etapas: true } }, documentos: { select: { nombre: true } } },
    });
  }
  createEtapa(data: Prisma.EtapaProcesoUncheckedCreateInput) {
    return this.db.etapaProceso.create({ data });
  }
  updateProcesoConDetalle(id: string, data: Prisma.ProcesoUpdateInput) {
    return this.db.proceso.update({ where: { id }, data, include: detalleInclude });
  }
  updateProceso(id: string, data: Prisma.ProcesoUpdateInput) {
    return this.db.proceso.update({ where: { id }, data });
  }
  findBaseDocs(procesoId: string) {
    return this.db.documentoProceso.findMany({ where: { procesoId } });
  }
  createManyDocs(data: Prisma.DocumentoProcesoCreateManyInput[]) {
    return this.db.documentoProceso.createMany({ data });
  }

  // --- patch /:id ---
  findParaPatch(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, select: { id: true, tipoProceso: { select: { esquemaFormulario: true } } } });
  }

  // --- auto-título laboral ---
  findParaRecompute(id: string) {
    return this.db.proceso.findFirst({
      where: { id, empresaId: this.e },
      select: { titulo: true, tituloManual: true, datos: true, tipoProceso: { select: { grupo: true, nombre: true } }, partes: { select: { esNuestroCliente: true, rol: true, litigante: { select: { nombre: true } } } } },
    });
  }
  updateTitulo(id: string, titulo: string) {
    return this.db.proceso.update({ where: { id }, data: { titulo } });
  }

  // --- partes ---
  findParte(parteId: string, procesoId: string) {
    return this.db.parteProceso.findFirst({ where: { id: parteId, proceso: { id: procesoId, empresaId: this.e } }, select: { id: true, litiganteId: true } });
  }
  findParteParaBorrar(parteId: string, procesoId: string) {
    return this.db.parteProceso.findFirst({ where: { id: parteId, proceso: { id: procesoId, empresaId: this.e } }, select: { id: true, esNuestroCliente: true } });
  }
  updateLitigante(id: string, data: Prisma.LitiganteUncheckedUpdateInput) {
    return this.db.litigante.update({ where: { id }, data });
  }
  updateParte(id: string, data: Prisma.ParteProcesoUncheckedUpdateInput) {
    return this.db.parteProceso.update({ where: { id }, data });
  }
  deleteParte(id: string) {
    return this.db.parteProceso.delete({ where: { id } });
  }

  // --- plantillas / documentos ---
  findProcesoTipoCaso(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, select: { tipoProcesoId: true, casoRelacionadoId: true } });
  }
  listPlantillas(tipoProcesoId: string) {
    return this.db.plantillaDocumento.findMany({ where: { tipoProcesoId }, select: { id: true, nombre: true, contenido: true }, orderBy: { nombre: "asc" } });
  }
  findProcesoConPartes(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.e }, include: { partes: { include: { litigante: true } } } });
  }
  findProcesoCodigo(id: string) {
    return this.db.proceso.findFirst({
      where: { id, empresaId: this.e },
      select: { id: true, codigoInterno: true, empresa: { select: { id: true, nombre: true } } },
    });
  }
  findPlantillaDeTipo(plantillaId: string, tipoProcesoId: string) {
    return this.db.plantillaDocumento.findFirst({ where: { id: plantillaId, tipoProcesoId } });
  }
  findCasoBase(casoRelacionadoId: string) {
    return this.db.proceso.findFirst({ where: { id: casoRelacionadoId, empresaId: this.e }, include: { partes: { include: { litigante: true } } } });
  }
  createDocumento(data: Prisma.DocumentoProcesoUncheckedCreateInput) {
    return this.db.documentoProceso.create({ data });
  }
  findDocumento(docId: string, procesoId: string) {
    return this.db.documentoProceso.findFirst({ where: { id: docId, proceso: { id: procesoId, empresaId: this.e } } });
  }
  updateDocumento(id: string, data: Prisma.DocumentoProcesoUncheckedUpdateInput) {
    return this.db.documentoProceso.update({ where: { id }, data });
  }
  deleteDocumento(id: string) {
    return this.db.documentoProceso.delete({ where: { id } });
  }
}
