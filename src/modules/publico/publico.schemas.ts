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

/** Cuerpo de "Habla con un asesor" (landing): contacto liviano. Crea un Prospecto
 *  WEB sin asignar. Requiere nombre + al menos un medio (correo o teléfono). Empresa
 *  y mensaje opcionales. `website` = honeypot anti-spam. */
export const contactoSchema = z
  .object({
    nombreContacto: z.string().trim().min(2, "Tu nombre es obligatorio").max(160),
    email: z.string().trim().email("Correo inválido").max(160).optional().or(z.literal("")),
    telefono: z.string().trim().max(40).optional().or(z.literal("")),
    nombreEmpresa: z.string().trim().max(160).optional(),
    mensaje: z.string().trim().max(2000).optional(),
    website: z.string().max(200).optional(),
  })
  .refine((d) => !!(d.email && d.email !== "") || !!(d.telefono && d.telefono !== ""), {
    message: "Deja al menos un correo o un teléfono",
    path: ["email"],
  });
