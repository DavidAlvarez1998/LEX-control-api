// Casos de uso de Planes (plataforma). Transacciones para create/update (reemplazan
// los sets de módulos/cupos). Devuelve DTOs ya mapeados. Sin Express.
import { Prisma, type RolEmpresa } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { PlanesRepository } from "./planes.repository";
import { toPlanDTO, toSuscripcionDTO } from "./planes.dto";
import type { CreatePlanInput, UpdatePlanInput } from "./planes.schemas";

const repo = () => new PlanesRepository();

export function listModulos() {
  return repo().listModulos();
}

export async function listSuscripciones() {
  const empresas = await repo().listEmpresasConSuscripcion();
  return empresas.map(toSuscripcionDTO);
}

export async function asignarPlan(empresaId: string, planId: string) {
  const r = repo();
  const plan = await r.findPlanById(planId);
  if (!plan) throw new HttpError(400, "El plan no existe");
  const empresa = await r.findEmpresaById(empresaId);
  if (!empresa) throw new HttpError(404, "Empresa no encontrada");
  await r.upsertSuscripcion(empresaId, planId);
  return { ok: true };
}

export async function listPlanes() {
  const planes = await repo().listPlanes();
  return planes.map(toPlanDTO);
}

export async function createPlan(input: CreatePlanInput) {
  const { clave, nombre, precioMensual, orden, activo, modulos, cuotas } = input;
  try {
    const plan = await prisma.$transaction(async (tx) => {
      const r = new PlanesRepository(tx);
      const p = await r.createPlan({ clave, nombre, precioMensual, orden: orden ?? 0, activo: activo ?? true });
      for (const moduloId of await r.moduloIdsNoBaseline(modulos)) await r.createPlanModulo(p.id, moduloId);
      for (const [rol, limite] of Object.entries(cuotas) as [RolEmpresa, number | null | undefined][]) {
        if (limite !== undefined) await r.createPlanCuota(p.id, rol, limite);
      }
      return r.findPlanFull(p.id);
    });
    return toPlanDTO(plan);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe un plan con esa clave");
    }
    throw err;
  }
}

export async function updatePlan(id: string, input: UpdatePlanInput) {
  const { modulos, cuotas, ...campos } = input;
  try {
    const plan = await prisma.$transaction(async (tx) => {
      const r = new PlanesRepository(tx);
      await r.updatePlan(id, campos);
      if (modulos !== undefined) {
        await r.deletePlanModulos(id);
        for (const moduloId of await r.moduloIdsNoBaseline(modulos)) await r.createPlanModulo(id, moduloId);
      }
      if (cuotas !== undefined) {
        await r.deletePlanCuotas(id);
        for (const [rol, limite] of Object.entries(cuotas) as [RolEmpresa, number | null | undefined][]) {
          if (limite !== undefined) await r.createPlanCuota(id, rol, limite);
        }
      }
      return r.findPlanFull(id);
    });
    return toPlanDTO(plan);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new HttpError(404, "Plan no encontrado");
    }
    throw err;
  }
}
