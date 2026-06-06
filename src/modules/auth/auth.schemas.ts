import { z } from "zod";
import { Rol } from "@prisma/client";

/** Body para iniciar sesión. */
export const loginSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
  // Rol esperado según el portal que hace el login (admin → ADMIN, client →
  // USUARIO). Si no coincide con el rol real del usuario, el login se rechaza.
  audience: z.nativeEnum(Rol).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Body para activar la cuenta y definir la contraseña (link de activación). */
export const setPasswordSchema = z.object({
  token: z.string().min(1, "Token requerido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
