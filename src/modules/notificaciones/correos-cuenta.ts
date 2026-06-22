// Envío best-effort de los correos transaccionales de cuenta. Arma la plantilla,
// llama enviarCorreo (SES) y NUNCA lanza: si el proveedor falla, lo registra y
// devuelve false → el flujo (creación/reset) sigue y el admin usa el link de
// respaldo. Ver openspec change correos-cuenta-invitacion-reset.
import { logger } from "../../shared/logger";
import { enviarCorreo } from "./correo.client";
import { plantillaInvitacion, plantillaReset, type ContextoInvitacion } from "./plantillas-cuenta";

/** Invitación al crear un usuario. Devuelve true solo si el proveedor confirmó. */
export async function enviarInvitacionCuenta(p: {
  to: string;
  nombre: string;
  activationUrl: string;
  contexto: ContextoInvitacion;
}): Promise<boolean> {
  try {
    const { subject, html } = plantillaInvitacion(p);
    const { enviado } = await enviarCorreo({ to: p.to, subject, html });
    return enviado;
  } catch (err) {
    logger.warn("correo de invitación no enviado", { to: p.to, err: String(err) });
    return false;
  }
}

/** Restablecimiento de contraseña. Devuelve true solo si el proveedor confirmó. */
export async function enviarResetCuenta(p: {
  to: string;
  nombre: string;
  activationUrl: string;
}): Promise<boolean> {
  try {
    const { subject, html } = plantillaReset(p);
    const { enviado } = await enviarCorreo({ to: p.to, subject, html });
    return enviado;
  } catch (err) {
    logger.warn("correo de restablecimiento no enviado", { to: p.to, err: String(err) });
    return false;
  }
}
