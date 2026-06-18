// Forma de salida de Usuarios. La lista oculta `activationToken` y deriva `estado`
// (ACTIVO/PENDIENTE/INACTIVO). Crear/editar ya vienen con PUBLIC_SELECT del repo.
import { deriveEstado } from "./usuarios.shared";

export function toUsuarioListDTO<
  T extends { activo: boolean; activationToken: string | null },
>(u: T) {
  const { activationToken, ...rest } = u;
  return { ...rest, estado: deriveEstado({ activo: u.activo, activationToken }) };
}
