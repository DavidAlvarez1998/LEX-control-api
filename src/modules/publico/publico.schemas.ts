import { z } from "zod";

/** Cuerpo de "Crea tu cuenta" (público): despacho/abogado + usuario administrador.
 *  APROVISIONA el tenant de una (Empresa + Suscripción trial + Usuario admin) y manda
 *  el correo de activación; no es una solicitud pendiente. El plan lo decide el servidor
 *  (trial), no el cliente. `website` es un honeypot anti-spam: los bots lo llenan, un
 *  humano no. Ver openspec/changes/cuenta-autoservicio-empresa. */
export const solicitudCuentaSchema = z.object({
  // Despacho / abogado
  nombreEmpresa: z.string().trim().min(2, "El nombre del despacho es obligatorio").max(160),
  nit: z.string().trim().min(1, "El NIT/CC es obligatorio").max(40),
  tarjeta: z.string().trim().max(60).optional().or(z.literal("")),
  // Usuario administrador
  nombreContacto: z.string().trim().min(2, "El nombre del usuario es obligatorio").max(120),
  email: z.string().trim().email("Correo inválido").max(160),
  telefono: z.string().trim().min(5, "El teléfono es obligatorio").max(30),
  // Honeypot anti-spam (oculto en el form)
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
