import { z } from "zod";

/** Cuerpo de "Solicitar demo" (público). `website` es un honeypot: los bots lo
 *  llenan; un humano lo deja vacío. */
export const solicitarDemoSchema = z.object({
  nombreEmpresa: z.string().trim().min(2, "El nombre del despacho es obligatorio").max(160),
  nombreContacto: z.string().trim().min(2, "Tu nombre es obligatorio").max(160),
  email: z.string().trim().email("Correo inválido").max(160),
  telefono: z.string().trim().max(40).optional(),
  mensaje: z.string().trim().max(2000).optional(),
  website: z.string().max(200).optional(), // honeypot — debe venir vacío
});
