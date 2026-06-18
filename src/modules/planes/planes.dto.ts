// Forma de salida de Planes (antes era `shape()` inline en el router). Aplana
// módulos→claves y cupos→mapa rol:límite; precioMensual Decimal→Number.
import type { Prisma, RolEmpresa } from "@prisma/client";

const n = (d: Prisma.Decimal) => Number(d);

type PlanRow = {
  id: string; clave: string; nombre: string; precioMensual: Prisma.Decimal; activo: boolean; orden: number;
  modulos: { modulo: { clave: string } }[];
  cuotas: { rolEmpresa: RolEmpresa; limite: number | null }[];
};

export function toPlanDTO(p: PlanRow) {
  return {
    id: p.id, clave: p.clave, nombre: p.nombre, precioMensual: n(p.precioMensual), activo: p.activo, orden: p.orden,
    modulos: p.modulos.map((m) => m.modulo.clave),
    cuotas: Object.fromEntries(p.cuotas.map((c) => [c.rolEmpresa, c.limite])),
  };
}

type EmpresaSuscripcion = {
  id: string; nombre: string; activo: boolean;
  suscripcion: { estado: string; plan: { clave: string; nombre: string } } | null;
};

export function toSuscripcionDTO(e: EmpresaSuscripcion) {
  return {
    id: e.id, nombre: e.nombre, activo: e.activo,
    plan: e.suscripcion?.plan.nombre ?? null,
    planClave: e.suscripcion?.plan.clave ?? null,
    estado: e.suscripcion?.estado ?? null,
  };
}
