// Forma pública de un plan para la landing (aplana módulos/cupos; precio→Number).
import type { Prisma, RolEmpresa } from "@prisma/client";

const n = (d: Prisma.Decimal) => Number(d);

type PlanRow = {
  clave: string; nombre: string; descripcion: string | null; precioMensual: Prisma.Decimal;
  modulos: { modulo: { clave: string } }[];
  cuotas: { rolEmpresa: RolEmpresa; limite: number | null }[];
};

export function toPlanPublico(p: PlanRow) {
  return {
    clave: p.clave,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precioMensual: n(p.precioMensual),
    modulos: p.modulos.map((m) => m.modulo.clave),
    cuotas: Object.fromEntries(p.cuotas.map((c) => [c.rolEmpresa, c.limite])),
  };
}
