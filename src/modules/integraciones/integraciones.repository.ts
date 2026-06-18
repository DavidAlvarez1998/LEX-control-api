// Acceso a datos de Integraciones estatales. Tenant-scoped (empresaId forzado).
import { Prisma } from "@prisma/client";
import { prisma, type PrismaLike } from "../../shared/prisma";

export class IntegracionesRepository {
  constructor(
    private readonly empresaId: string,
    private readonly db: PrismaLike = prisma,
  ) {}

  findProcesoScoped(id: string) {
    return this.db.proceso.findFirst({ where: { id, empresaId: this.empresaId }, select: { id: true, empresaId: true, radicado: true } });
  }
  listActuaciones(procesoId: string) {
    return this.db.actuacionJudicial.findMany({ where: { procesoId }, orderBy: [{ fechaActuacion: "desc" }, { createdAt: "desc" }] });
  }
  listSyncLogs(procesoId: string) {
    return this.db.integrationSyncLog.findMany({ where: { procesoId, empresaId: this.empresaId }, orderBy: { createdAt: "desc" }, take: 50 });
  }
  listProviderConfigs() {
    return this.db.providerConfig.findMany({ where: { empresaId: this.empresaId }, orderBy: { proveedor: "asc" } });
  }
  upsertProviderConfig(
    proveedor: string,
    create: Omit<Prisma.ProviderConfigUncheckedCreateInput, "empresaId" | "proveedor">,
    update: Prisma.ProviderConfigUncheckedUpdateInput,
  ) {
    return this.db.providerConfig.upsert({
      where: { empresaId_proveedor: { empresaId: this.empresaId, proveedor } },
      create: { ...create, empresaId: this.empresaId, proveedor },
      update,
    });
  }
}
