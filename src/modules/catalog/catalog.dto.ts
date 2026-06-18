// Forma de salida de un Tipo de Proceso (antes `serializeTipo` inline en el router):
// aplana las áreas a `areaSlugs`. Áreas y plantillas se devuelven tal cual el modelo.
import type { Prisma } from "@prisma/client";

type TipoConAreas = Prisma.TipoProcesoGetPayload<{ include: { areas: { include: { area: true } } } }>;

export function serializeTipo(t: TipoConAreas) {
  return {
    id: t.id,
    nombre: t.nombre,
    descripcion: t.descripcion,
    jurisdiccion: t.jurisdiccion,
    esquemaFormulario: t.esquemaFormulario,
    etapas: t.etapas,
    esquemaVersion: t.esquemaVersion,
    empresaId: t.empresaId,
    esJudicial: t.esJudicial,
    clienteOpcional: t.clienteOpcional,
    grupo: t.grupo,
    actualizado: t.actualizado,
    areaSlugs: t.areas.map((a) => a.area.slug),
  };
}
