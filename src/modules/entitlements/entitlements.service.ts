// Motor de entitlements: dado un empresaId resuelve qué módulos tiene
// habilitados y el cupo de sillas por rol. Una sola fuente para la puerta de
// módulos (requirePermiso) y la puerta de cupos (roles.service).
// Ver openspec/changes/foundations-roles-plans-clientes/.
import { RolEmpresa } from "@prisma/client";
import { prisma } from "../../index";

export type Entitlements = {
  modulosHabilitados: Set<string>; // claves de módulo
  cuotas: Map<RolEmpresa, number>; // Infinity = ilimitado; ausente/0 = sin cupo
};

const TODOS_LOS_ROLES: RolEmpresa[] = [
  RolEmpresa.ADMINISTRADOR,
  RolEmpresa.JURIDICO,
  RolEmpresa.CONTABLE,
  RolEmpresa.COMERCIAL,
];

/**
 * Resuelve los entitlements de una empresa. `empresaId` SIEMPRE viene del token
 * (nunca del cliente). Sin suscripción ACTIVA → solo módulos baseline y todos
 * los cupos en 0 (bloquea nuevas sillas; los miembros activos siguen
 * funcionando hasta reactivar).
 */
export async function resolveEntitlements(empresaId: string): Promise<Entitlements> {
  // Baseline = siempre activos para todos.
  const baseline = await prisma.modulo.findMany({
    where: { esBaseline: true, activo: true },
    select: { clave: true },
  });
  const baselineClaves = baseline.map((m) => m.clave);

  const modulosHabilitados = new Set<string>(baselineClaves);
  const cuotas = new Map<RolEmpresa, number>(TODOS_LOS_ROLES.map((r) => [r, 0]));

  const sus = await prisma.suscripcion.findUnique({
    where: { empresaId },
    include: {
      plan: {
        include: {
          modulos: { include: { modulo: { select: { clave: true } } } },
          cuotas: true,
        },
      },
      modulos: { include: { modulo: { select: { clave: true } } } },
      cuotas: true,
    },
  });

  // Sin suscripción ACTIVA → baseline + cupos 0.
  if (!sus || sus.estado !== "ACTIVA") {
    return { modulosHabilitados, cuotas };
  }

  // Módulos del plan (no-baseline).
  for (const pm of sus.plan.modulos) modulosHabilitados.add(pm.modulo.clave);
  // Cupos del plan (NULL = ilimitado).
  for (const pc of sus.plan.cuotas) {
    cuotas.set(pc.rolEmpresa, pc.limite === null ? Infinity : pc.limite);
  }
  // Overrides por empresa: módulos.
  for (const sm of sus.modulos) {
    if (sm.habilitado) modulosHabilitados.add(sm.modulo.clave);
    else modulosHabilitados.delete(sm.modulo.clave);
  }
  // Overrides por empresa: cupos.
  for (const sc of sus.cuotas) {
    cuotas.set(sc.rolEmpresa, sc.limite === null ? Infinity : sc.limite);
  }

  // Los baseline son siempre-activos: un override no los puede quitar.
  for (const c of baselineClaves) modulosHabilitados.add(c);

  return { modulosHabilitados, cuotas };
}
