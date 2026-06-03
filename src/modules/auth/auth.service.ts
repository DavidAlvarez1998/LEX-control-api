import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Rol } from "@prisma/client";
import { env } from "../../config/env";

const SALT_ROUNDS = 10;
const TOKEN_TTL = "1d";

/** Datos que viajan dentro del JWT. */
export type JwtPayload = { sub: string; rol: Rol };

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
