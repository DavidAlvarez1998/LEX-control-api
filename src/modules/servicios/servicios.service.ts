// Casos de uso de Servicios (catálogo global). Sin Express. Preserva los mensajes
// de error específicos (404 / 409 asignado a empresas).
import { Prisma } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { ServiciosRepository } from "./servicios.repository";
import type { CreateServicioInput, UpdateServicioInput } from "./servicios.schemas";

const repo = () => new ServiciosRepository();

export function listServicios() {
  return repo().list();
}

export async function getServicio(id: string) {
  const servicio = await repo().findById(id);
  if (!servicio) throw new HttpError(404, "Servicio no encontrado");
  return servicio;
}

export function createServicio(input: CreateServicioInput) {
  return repo().create(input);
}

export async function updateServicio(id: string, input: UpdateServicioInput) {
  try {
    return await repo().update(id, input);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new HttpError(404, "Servicio no encontrado");
    }
    throw err;
  }
}

export async function deleteServicio(id: string): Promise<void> {
  try {
    await repo().delete(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") throw new HttpError(404, "Servicio no encontrado");
      if (err.code === "P2003" || err.code === "P2014") {
        throw new HttpError(409, "No se puede eliminar: el servicio está asignado a una o más empresas");
      }
    }
    throw err;
  }
}
