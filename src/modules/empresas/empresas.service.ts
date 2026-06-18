// Casos de uso de Empresas (plataforma). Transacciones para create/update con
// replace-set de servicios asignados. Sin Express. Preserva mensajes 404/409.
import { Prisma } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { EmpresasRepository } from "./empresas.repository";
import type { CreateEmpresaInput, ServicioAsignadoInput, UpdateEmpresaInput } from "./empresas.schemas";

/**
 * Valida los `servicioId` contra el catálogo y construye las filas de EmpresaServicio,
 * rellenando los precios omitidos con los de referencia del catálogo. 400 si no existe.
 */
async function resolverAsignaciones(
  repo: EmpresasRepository,
  empresaId: string,
  servicios: ServicioAsignadoInput[],
) {
  const ids = servicios.map((s) => s.servicioId);
  const catalogo = await repo.findCatalogByIds(ids);
  const porId = new Map(catalogo.map((s) => [s.id, s]));
  return servicios.map((s) => {
    const ref = porId.get(s.servicioId);
    if (!ref) throw new HttpError(400, `El servicio ${s.servicioId} no existe`);
    return {
      empresaId,
      servicioId: s.servicioId,
      precioBase: s.precioBase ?? ref.precioBase,
      precioPorUnidad: s.precioPorUnidad ?? ref.precioPorUnidad,
      incluidos: s.incluidos ?? ref.incluidos,
      activo: s.activo ?? true,
    };
  });
}

export function listEmpresas() {
  return new EmpresasRepository().list();
}

export async function getEmpresa(id: string) {
  const empresa = await new EmpresasRepository().findById(id);
  if (!empresa) throw new HttpError(404, "Empresa no encontrada");
  return empresa;
}

export async function createEmpresa(input: CreateEmpresaInput) {
  const { servicios, ...datos } = input;
  const base = new EmpresasRepository();
  try {
    const filas = servicios ? await resolverAsignaciones(base, "", servicios) : [];
    return await prisma.$transaction(async (tx) => {
      const r = new EmpresasRepository(tx);
      const creada = await r.create(datos);
      if (filas.length) await r.createManyEmpresaServicio(filas.map((f) => ({ ...f, empresaId: creada.id })));
      return r.findFull(creada.id);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe una empresa con ese RFC/NIT");
    }
    throw err;
  }
}

export async function updateEmpresa(id: string, input: UpdateEmpresaInput) {
  const { servicios, ...datos } = input;
  const base = new EmpresasRepository();
  try {
    const filas = servicios !== undefined ? await resolverAsignaciones(base, id, servicios) : null;
    return await prisma.$transaction(async (tx) => {
      const r = new EmpresasRepository(tx);
      await r.update(id, datos);
      if (filas !== null) {
        // Replace-set: upsert de las indicadas + borra las omitidas.
        const idsDeseados = filas.map((f) => f.servicioId);
        await r.deleteEmpresaServiciosNotIn(id, idsDeseados);
        for (const f of filas) {
          const { empresaId: _e, servicioId, ...precios } = f;
          await r.upsertEmpresaServicio(id, servicioId, f, precios);
        }
      }
      return r.findFull(id);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") throw new HttpError(404, "Empresa no encontrada");
      if (err.code === "P2002") throw new HttpError(409, "Ya existe una empresa con ese RFC/NIT");
    }
    throw err;
  }
}

export async function deleteEmpresa(id: string): Promise<void> {
  try {
    await new EmpresasRepository().delete(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new HttpError(404, "Empresa no encontrada");
    }
    throw err;
  }
}
