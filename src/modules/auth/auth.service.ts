import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Rol } from "@prisma/client";
import { env } from "../../config/env";

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

/** Firma un JWT con el id y rol del usuario. */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

/** Verifica y decodifica un JWT. Lanza si es inválido o expiró. */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
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
