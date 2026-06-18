// Forma del `user` en las respuestas de auth (login y /me comparten la misma).
import type { Rol, RolEmpresa } from "@prisma/client";

type UsuarioConRelaciones = {
  id: string; nombre: string; email: string; rol: Rol; esAdminEmpresa: boolean;
  rolesEmpresa: { rolEmpresa: RolEmpresa }[];
  empresa: { nombre: string } | null;
};

export function toAuthUser(u: UsuarioConRelaciones) {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    esAdminEmpresa: u.esAdminEmpresa,
    roles: u.rolesEmpresa.map((r) => r.rolEmpresa),
    empresa: u.empresa?.nombre ?? null,
  };
}
