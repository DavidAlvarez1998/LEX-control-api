// Casos de uso de Litigantes (sin Express). empresaId vía TenantContext → repositorio.
import { Prisma } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { LitigantesRepository } from "./litigantes.repository";
import type { CreateLitiganteInput, UpdateLitiganteInput } from "./litigantes.schemas";

export function listLitigantes(t: TenantContext, q?: string) {
  return new LitigantesRepository(empresaIdOrThrow(t)).list(q);
}

export async function getLitigante(t: TenantContext, id: string) {
  const litigante = await new LitigantesRepository(empresaIdOrThrow(t)).findById(id);
  if (!litigante) throw new HttpError(404, "Litigante no encontrado");
  return litigante;
}

export function createLitigante(t: TenantContext, input: CreateLitiganteInput) {
  return new LitigantesRepository(empresaIdOrThrow(t)).create(input);
}

export async function updateLitigante(t: TenantContext, id: string, input: UpdateLitiganteInput) {
  const repo = new LitigantesRepository(empresaIdOrThrow(t));
  const count = await repo.updateScoped(id, input);
  if (count === 0) throw new HttpError(404, "Litigante no encontrado");
  return repo.findRaw(id);
}

export async function deleteLitigante(t: TenantContext, id: string): Promise<void> {
  const repo = new LitigantesRepository(empresaIdOrThrow(t));
  const existe = await repo.existsScoped(id);
  if (!existe) throw new HttpError(404, "Litigante no encontrado");
  try {
    await repo.delete(id);
  } catch (err) {
    // Mensaje específico (se conserva del comportamiento previo).
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2003" || err.code === "P2014")) {
      throw new HttpError(409, "No se puede eliminar: el litigante está vinculado a un proceso");
    }
    throw err;
  }
}
