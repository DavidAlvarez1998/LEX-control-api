import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Rol } from "@prisma/client";
import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";
import { AuthRepository } from "./auth.repository";
import { toAuthUser } from "./auth.dto";
import type { LoginInput, SetPasswordInput } from "./auth.schemas";

const SALT_ROUNDS = 10;
// Vida absoluta del JWT: la sesión caduca 8h después del login, sin importar la
// actividad. El frontend lee el `exp` para cerrar sesión de forma proactiva.
const TOKEN_TTL = "8h";

/** Datos que viajan dentro del JWT.
 *  `tv` (token version) refleja `Usuario.tokenVersion` al firmar; al subir esa
 *  versión en BD, los tokens viejos dejan de coincidir y se rechazan. Es
 *  opcional para tolerar tokens emitidos antes de este cambio (se tratan como 0). */
export type JwtPayload = { sub: string; rol: Rol; tv?: number };

/** Hashea una contraseña en texto plano (bcrypt). */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Compara una contraseña en texto plano contra su hash almacenado. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Algoritmo único y explícito (HMAC-SHA256). Fijarlo en sign Y verify evita la
// confusión de algoritmo (p. ej. aceptar 'none' o un RS256 con la clave pública como
// HMAC); sin la lista en verify, jsonwebtoken acepta cualquier algoritmo HMAC.
const JWT_ALG: jwt.Algorithm = "HS256";

/** Firma un JWT con el id y rol del usuario. */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: TOKEN_TTL, algorithm: JWT_ALG });
}

/** Verifica y decodifica un JWT. Lanza si es inválido o expiró. */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret, { algorithms: [JWT_ALG] }) as JwtPayload;
}

/** Hash SHA-256 de un token de activación (alta entropía → no necesita bcrypt). */
export function hashActivationToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Genera un token de activación: `raw` se entrega, `hash` se guarda en la BD. */
export function generateActivationToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashActivationToken(raw) };
}

// ===================== CASOS DE USO =====================

/** Verifica credenciales (con separación estricta de portales) y devuelve JWT + user. */
export async function login(body: LoginInput) {
  // Mensaje genérico: no revela si falló el email, la contraseña o el estado.
  const invalidas = new HttpError(401, "Credenciales inválidas");
  const usuario = await new AuthRepository().findByEmail(body.email);
  if (!usuario || !usuario.activo) throw invalidas;
  if (usuario.empresa && !usuario.empresa.activo) throw invalidas; // empresa desactivada
  // Se valida la contraseña ANTES de revelar el estado "pendiente": así un mensaje
  // específico (activación/reset pendiente) solo se muestra a quien ya conoce la
  // contraseña — no permite enumerar cuentas. La contraseña vieja sigue coincidiendo
  // tras un reset (no se borra el hash, solo se exige re-definirla por el enlace).
  const passwordOk = !!usuario.password && (await verifyPassword(body.password, usuario.password));
  if (usuario.activationToken) {
    // Pendiente de activar/restablecer: la contraseña vieja ya no sirve para entrar.
    throw passwordOk
      ? new HttpError(401, "Tu cuenta tiene un restablecimiento de contraseña pendiente. Revisa tu correo y usa el enlace para definir una nueva contraseña.")
      : invalidas;
  }
  if (!passwordOk) throw invalidas;

  // Portal admin (audience ADMIN) admite ADMIN+COMERCIAL; portal cliente solo USUARIO.
  if (body.audience) {
    const rolesDelPortal = body.audience === "USUARIO" ? ["USUARIO"] : ["ADMIN", "COMERCIAL"];
    if (!rolesDelPortal.includes(usuario.rol)) throw invalidas;
  }
  const token = signToken({ sub: usuario.id, rol: usuario.rol, tv: usuario.tokenVersion });
  return { token, user: toAuthUser(usuario) };
}

/** Usuario autenticado con datos FRESCOS de BD (refresca la sesión sin re-login). */
export async function me(userId: string) {
  const usuario = await new AuthRepository().findById(userId);
  if (!usuario) throw new HttpError(401, "Token inválido o expirado");
  return toAuthUser(usuario);
}

/** Correo (y nombre) asociado a un token de activación VÁLIDO. Sirve para mostrar
 *  el correo —no editable— en la pantalla de activación. Lanza si el token es
 *  inválido o expiró (mismo criterio que setPassword). */
export async function activationInfo(token: string) {
  const usuario = await new AuthRepository().findByActivationToken(hashActivationToken(token));
  if (!usuario || !usuario.activationExpires || usuario.activationExpires < new Date()) {
    throw new HttpError(400, "El enlace de activación es inválido o expiró");
  }
  return { email: usuario.email, nombre: usuario.nombre };
}

/** Activa la cuenta con el token y define la contraseña (revoca tokens previos). */
export async function setPassword(body: SetPasswordInput) {
  const repo = new AuthRepository();
  const usuario = await repo.findByActivationToken(hashActivationToken(body.token));
  if (!usuario || !usuario.activationExpires || usuario.activationExpires < new Date()) {
    throw new HttpError(400, "El enlace de activación es inválido o expiró");
  }
  await repo.activate(usuario.id, {
    password: await hashPassword(body.password),
    activationToken: null,
    activationExpires: null,
    activo: true,
    tokenVersion: { increment: 1 },
  });
  return { ok: true };
}
