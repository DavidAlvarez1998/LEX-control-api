// Casos de uso públicos (landing del portal cliente). Sin auth/tenant.
import type { z } from "zod";
import { PublicoRepository } from "./publico.repository";
import { toPlanPublico } from "./publico.dto";
import type { contactoSchema, solicitudCuentaSchema } from "./publico.schemas";

type SolicitudInput = z.infer<typeof solicitudCuentaSchema>;
type ContactoInput = z.infer<typeof contactoSchema>;

export async function listPlanes() {
  return (await new PublicoRepository().listPlanesActivos()).map(toPlanPublico);
}

/**
 * Solicitud de cuenta (modelo híbrido): crea un Prospecto (canalEntrada=WEB) con los
 * datos del despacho + admin + plan. Honeypot `website` → no-op silencioso (bot).
 * Devuelve `creado` para que el router responda 201 (creado) o 200 (honeypot).
 */
export async function solicitarCuenta(b: SolicitudInput): Promise<{ creado: boolean }> {
  if (b.website && b.website.trim() !== "") return { creado: false };
  const repo = new PublicoRepository();
  const plan = b.planClave ? await repo.findPlanByClave(b.planClave) : null;
  const notas = [
    "Solicitud de cuenta vía landing.",
    b.emailEmpresa ? `Correo empresa: ${b.emailEmpresa}` : null,
    b.telefonoEmpresa ? `Tel. empresa: ${b.telefonoEmpresa}` : null,
  ].filter(Boolean).join(" · ");
  await repo.createProspecto({
    nombreEmpresa: b.nombreEmpresa, numeroDocumento: b.nit ?? null,
    nombreContacto: b.nombreContacto, email: b.email, telefono: b.telefono ?? null,
    canalEntrada: "WEB", planInteresId: plan?.id ?? null, notas,
  });
  return { creado: true };
}

/**
 * Contacto desde la landing ("Habla con un asesor"): crea un Prospecto
 * (canalEntrada=WEB) SIN comercial asignado (comercialId queda null → bandeja de no
 * asignados) y con el mensaje del visitante en `notas`. Honeypot `website` → no-op.
 * `nombreEmpresa` cae al nombre del contacto cuando no se da (el modelo lo exige).
 */
export async function contactar(b: ContactoInput): Promise<{ creado: boolean }> {
  if (b.website && b.website.trim() !== "") return { creado: false };
  const repo = new PublicoRepository();
  const notas = [
    "Contacto desde landing.",
    b.mensaje?.trim() ? `Mensaje: ${b.mensaje.trim()}` : null,
  ].filter(Boolean).join(" · ");
  await repo.createProspecto({
    nombreEmpresa: b.nombreEmpresa?.trim() || b.nombreContacto,
    nombreContacto: b.nombreContacto,
    email: b.email?.trim() || null,
    telefono: b.telefono?.trim() || null,
    canalEntrada: "WEB", // comercialId omitido → null (sin asignar); estado → NUEVO
    notas,
  });
  return { creado: true };
}
