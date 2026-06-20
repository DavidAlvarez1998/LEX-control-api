// Forma de salida de un Tipo de Proceso (antes `serializeTipo` inline en el router):
// aplana las áreas a `areaSlugs`. Áreas y plantillas se devuelven tal cual el modelo.
import type { CategoriaProceso, Prisma } from "@prisma/client";

type TipoConAreas = Prisma.TipoProcesoGetPayload<{
  include: { areas: { include: { area: true } }; categoria: true };
}>;

export function serializeTipo(t: TipoConAreas) {
  return {
    id: t.id,
    nombre: t.nombre,
    nombreVisual: t.nombreVisual,
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
    categoriaId: t.categoriaId,
    categoriaSlug: t.categoria?.slug ?? null,
    areaSlugs: t.areas.map((a) => a.area.slug),
  };
}

export function serializeCategoria(c: CategoriaProceso) {
  return {
    id: c.id,
    slug: c.slug,
    nombre: c.nombre,
    jurisdiccion: c.jurisdiccion,
    activo: c.activo,
    proximamente: c.proximamente,
    orden: c.orden,
  };
}
