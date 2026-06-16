import { z } from "zod";

/** Cuerpo de "Crear cuenta" (público): datos del despacho + del usuario admin +
 *  plan elegido. Genera una SOLICITUD (Prospecto) pendiente de aprobación; no crea
 *  acceso. `website` es un honeypot anti-spam: los bots lo llenan, un humano no. */
export const solicitudCuentaSchema = z.object({
  // Empresa / despacho
  nombreEmpresa: z.string().trim().min(2, "El nombre del despacho es obligatorio").max(160),
  nit: z.string().trim().max(40).optional(),
  emailEmpresa: z.string().trim().email("Correo de empresa inválido").max(160).optional().or(z.literal("")),
  telefonoEmpresa: z.string().trim().max(40).optional(),
  // Usuario administrador
  nombreContacto: z.string().trim().min(2, "El nombre del administrador es obligatorio").max(160),
  email: z.string().trim().email("Correo del administrador inválido").max(160),
  telefono: z.string().trim().max(40).optional(),
  // Plan elegido (clave del catálogo público) + honeypot
  planClave: z.string().trim().max(60).optional(),
  website: z.string().max(200).optional(),
});
