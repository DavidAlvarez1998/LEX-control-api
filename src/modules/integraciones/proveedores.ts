// Registro de proveedores de actuaciones. Resuelve QUÉ adapter usar para un
// despacho, respetando `ProviderConfig.habilitado` (spec: "A provider MUST be
// skipped when disabled for that despacho"). Los reales (CPNU/RUES) llegan en
// Fases C/D; por ahora el único candidato es el MOCK, y solo si está activo.
import { prisma } from "../../index";
import { env } from "../../config/env";
import type { ActuacionesProvider } from "./integraciones.types";
import { mockActuacionesAdapter } from "./mockActuaciones.client";

// Cada proveedor de actuaciones tiene una CLAVE estable para buscar su
// ProviderConfig. El mock simula a CPNU, así que comparte su clave.
const CLAVE_POR_NOMBRE: Record<string, string> = {
  [mockActuacionesAdapter.nombre]: "cpnu",
};

/** Clave de ProviderConfig de un adapter (para habilitar/deshabilitar por despacho). */
export function claveProveedor(p: ActuacionesProvider): string {
  return CLAVE_POR_NOMBRE[p.nombre] ?? p.nombre.toLowerCase();
}

/** Candidatos de actuaciones disponibles en este entorno, en orden de preferencia. */
function candidatos(): ActuacionesProvider[] {
  const lista: ActuacionesProvider[] = [];
  if (env.integraciones.mockActuaciones) lista.push(mockActuacionesAdapter);
  return lista;
}

/**
 * Devuelve el proveedor de actuaciones a usar para el despacho, o `null` si no
 * hay ninguno disponible/habilitado. Un `ProviderConfig` con `habilitado=false`
 * para la clave del proveedor lo descarta.
 */
export async function resolverProveedorActuaciones(empresaId: string): Promise<ActuacionesProvider | null> {
  const disponibles = candidatos();
  if (disponibles.length === 0) return null;

  const configs = await prisma.providerConfig.findMany({
    where: { empresaId, proveedor: { in: disponibles.map(claveProveedor) } },
    select: { proveedor: true, habilitado: true },
  });
  const deshabilitado = new Set(configs.filter((c) => !c.habilitado).map((c) => c.proveedor));

  return disponibles.find((p) => !deshabilitado.has(claveProveedor(p))) ?? null;
}
