// Forma de salida de Mi Empresa: equipo (oculta activationToken, deriva estado y
// aplana roles) y cupos (cap/usados por rol).
import { RolEmpresa } from "@prisma/client";
import { deriveEstado } from "../usuarios/usuarios.shared";

export function toMiembroDTO<
  T extends { activo: boolean; activationToken: string | null; rolesEmpresa: { rolEmpresa: RolEmpresa }[] },
>(u: T) {
  const { activationToken, rolesEmpresa, ...rest } = u;
  return {
    ...rest,
    roles: rolesEmpresa.map((r) => r.rolEmpresa),
    estado: deriveEstado({ activo: u.activo, activationToken }),
  };
}

export function toCuposDTO(
  cuotas: Map<RolEmpresa, number>,
  usados: { rolEmpresa: RolEmpresa; _count: { rolEmpresa: number } }[],
) {
  const usadosPorRol = new Map(usados.map((u) => [u.rolEmpresa, u._count.rolEmpresa]));
  return (Object.values(RolEmpresa) as RolEmpresa[]).map((rol) => {
    const cap = cuotas.get(rol) ?? 0;
    return { rol, cap: cap === Infinity ? null : cap, usados: usadosPorRol.get(rol) ?? 0 };
  });
}
